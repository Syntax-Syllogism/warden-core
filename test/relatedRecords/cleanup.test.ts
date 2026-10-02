/* eslint-disable camelcase -- Salesforce API names in fixtures. */
import { expect } from 'chai';
import sinon from 'sinon';
import { cleanupFailedPlans, type CleanupEntry } from '../../src/relatedRecords/cleanup.js';
import { applyRelatedPhase } from '../../src/relatedRecords/apply.js';
import type { AppliedRelatedRecordResult, RelatedRecordPlan } from '../../src/relatedRecords/types.js';
import { renderProvisionHuman } from '../../src/provisioning/output.js';
import { renderProvisionCsv } from '../../src/shared/output.js';

const created = (
  phase: 'before' | 'after',
  sobject = 'Contact',
  recordId = '003contact'
): AppliedRelatedRecordResult => ({
  relationship: `${phase}-${recordId}`,
  phase,
  sobject,
  recordId,
  action: 'created',
  status: 'applied',
  createdInThisRun: true,
});
const entry = (results: AppliedRelatedRecordResult[], overrides: Partial<CleanupEntry> = {}): CleanupEntry => ({
  planId: 'one',
  userSaved: false,
  linkedFields: [],
  relatedPlans: [],
  results,
  ...overrides,
});
const relatedPlan = (overrides: Partial<RelatedRecordPlan> = {}): RelatedRecordPlan => ({
  relationship: 'contact',
  phase: 'before',
  sobject: 'Contact',
  matchField: 'External_Id__c',
  matchValue: 'one',
  fields: { External_Id__c: 'one' },
  pendingUserIdFields: [],
  mode: 'sync',
  status: 'planned',
  errors: [],
  ...overrides,
});

describe('related-record cleanup', () => {
  it('deletes only creations, in reverse phase order, and never deletes User records', async () => {
    const remove = sinon.stub().resolves([{ success: true, errors: [] }]);
    const userDelete = sinon.stub();
    const sobject = sinon.stub().callsFake((name: string) => ({ delete: name === 'User' ? userDelete : remove }));
    const results = await cleanupFailedPlans({ sobject } as never, [
      entry([
        { ...created('before'), status: 'failed', error: 'Link read failed' },
        created('after', 'Employee__c', 'a01employee'),
        { ...created('before', 'Contact', '003existing'), action: 'updated', createdInThisRun: false },
        { ...created('after', 'Contact', '003matched'), action: 'matched', createdInThisRun: undefined },
        created('before', 'User', '005user'),
      ]),
    ]);
    expect(sobject.getCalls().map((call) => call.args[0] as string)).to.deep.equal(['Employee__c', 'Contact']);
    expect(remove.getCalls().map((call) => call.args as unknown[])).to.deep.equal([
      [['a01employee'], { allOrNone: false }],
      [['003contact'], { allOrNone: false }],
    ]);
    expect(userDelete.called).to.equal(false);
    expect(results.get('one')?.[1]).not.to.have.property('error');
    expect(results.get('one')?.map((result) => result.action)).to.deep.equal(['deleted', 'deleted']);
  });

  it('keeps a Person Account referenced by a saved User and reports why', async () => {
    const result = created('before', 'Account', '001person');
    const remove = sinon.stub();
    const outcomes = await cleanupFailedPlans({ sobject: () => ({ delete: remove }) } as never, [
      entry([result], {
        userSaved: true,
        linkedFields: ['ContactId'],
        relatedPlans: [
          relatedPlan({
            relationship: result.relationship,
            sobject: 'Account',
            linkUser: { userField: 'ContactId', fromRelatedField: 'PersonContactId' },
          }),
        ],
      }),
    ]);
    expect(remove.called).to.equal(false);
    expect(outcomes.get('one')?.[0]).to.include({ action: 'skipped', status: 'skipped' });
    expect(outcomes.get('one')?.[0].detail).to.contain('saved User').and.contain('ContactId');
    expect(JSON.stringify(outcomes.get('one'))).not.to.contain('createdInThisRun');
  });

  it('batches across users at 200 ids and maps results back by index', async () => {
    const remove = sinon.stub().callsFake(async (ids: string[]) => ids.map(() => ({ success: true, errors: [] })));
    const entries = Array.from({ length: 250 }, (_, index) =>
      entry([created('before', 'Contact', `003-${index}`)], { planId: String(index) })
    );
    const results = await cleanupFailedPlans({ sobject: () => ({ delete: remove }) } as never, entries);
    expect(remove.getCalls().map((call) => (call.args[0] as string[]).length)).to.deep.equal([200, 50]);
    expect(results.get('249')?.[0]).to.include({ recordId: '003-249', action: 'deleted' });
  });

  it('records row, transport, and missing-result failures and continues to the next phase', async () => {
    const remove = sinon.stub();
    remove
      .onCall(0)
      .resolves([
        { success: false, errors: [{ statusCode: 'DELETE_FAILED', message: 'blocked', fields: ['ParentId'] }] },
      ]);
    remove.onCall(1).rejects(new Error('offline'));
    remove.onCall(2).resolves([]);
    const results = await cleanupFailedPlans({ sobject: () => ({ delete: remove }) } as never, [
      entry([
        created('after', 'Employee__c', 'a1'),
        created('before', 'Contact', 'c1'),
        created('before', 'Contact', 'c2'),
        created('before', 'Account', 'a2'),
      ]),
    ]);
    expect(results.get('one')?.map((result) => result.action)).to.deep.equal(Array(4).fill('deleteFailed'));
    expect(results.get('one')?.map((result) => result.error)).to.deep.equal([
      'DELETE_FAILED: blocked (fields: ParentId)',
      'offline',
      'offline',
      'Related record delete returned no result.',
    ]);
  });

  it('stamps ownership only for successful creates in either phase', async () => {
    const create = sinon.stub().resolves([
      { success: true, id: '003new', errors: [] },
      { success: false, errors: [{ message: 'blocked' }] },
    ]);
    const update = sinon.stub().resolves([{ success: true, id: '003existing', errors: [] }]);
    for (const phase of ['before', 'after'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const results = await applyRelatedPhase(
        { sobject: () => ({ create, update }) } as never,
        [
          {
            planId: 'one',
            relatedPlans: [
              relatedPlan({ phase }),
              relatedPlan({ phase }),
              relatedPlan({ phase, existingId: '003existing' }),
            ],
          },
        ],
        phase
      );
      expect(results.get('one')?.map((result) => result.createdInThisRun)).to.deep.equal([true, false, false]);
    }
  });

  it('renders cleanup actions through existing human and CSV rows', () => {
    const result = {
      summary: { total: 1, created: 0, updated: 0, failed: 1, warnings: 0 },
      users: [
        {
          key: 'one',
          personas: [],
          matchedBy: null,
          matchValue: null,
          matched: false,
          status: 'failed' as const,
          actions: [],
          errors: ['User save failed'],
          relatedRecords: [
            { ...created('before'), action: 'deleted' as const },
            { ...created('after'), action: 'deleteFailed' as const, status: 'failed' as const, error: 'blocked' },
          ],
        },
      ],
    };
    expect(renderProvisionHuman(result)).to.contain('deleted').and.contain('deleteFailed').and.contain('blocked');
    const csv = renderProvisionCsv(result);
    expect(csv).to.contain('deleted').and.contain('deleteFailed');
    expect(csv.split('\n')[0]).to.equal(renderProvisionCsv({ users: [] }).split('\n')[0]);
  });
});
