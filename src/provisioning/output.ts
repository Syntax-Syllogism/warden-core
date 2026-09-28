import type { MessageLookup } from '../lifecycle/diffOutput.js';
import { renderMessagesFor } from '../renderMessages.js';
import type { ProvisionResult } from './provisionUserUseCase.js';

const renderMatchProvenance = (user: ProvisionResult['users'][number]): string => {
  if (!user.matchedBy) return 'unmatched';
  const label = user.matched ? 'matched' : 'unmatched';
  return user.matchValue === null ? `${label} ${user.matchedBy}` : `${label} ${user.matchedBy} = ${user.matchValue}`;
};

export const renderProvisionHuman = (
  output: ProvisionResult,
  personaSourceLabel = 'file',
  lookup: MessageLookup = renderMessagesFor('provision')
): string => {
  const lines: string[] = [`Persona source: ${personaSourceLabel}`, ''];
  for (const user of output.users) {
    lines.push(`${user.key}${user.id ? ` · ${user.id}` : ''} · ${user.status}`);
    lines.push(`  ${renderMatchProvenance(user)} · personas: ${user.personas.join(', ') || '(none)'}`);
    for (const action of user.actions) lines.push(`  action: ${action}`);
    for (const related of user.relatedRecords ?? []) {
      const recordId = related.recordId ? ` · ${related.recordId}` : '';
      lines.push(`  related: ${related.phase} ${related.sobject} ${related.action}${recordId}`);
      if (related.error) lines.push(`  related error: ${related.error}`);
    }
    for (const error of user.errors) lines.push(`  error: ${error}`);
  }
  lines.push('');
  lines.push(
    lookup('info.summary', [
      String(output.summary.total),
      String(output.summary.created),
      String(output.summary.updated),
      String(output.summary.failed),
    ])
  );
  if (output.licenses) {
    lines.push('', lookup('info.licenses.header'));
    for (const license of output.licenses) {
      const available = license.unlimited ? 'unlimited' : String(license.available);
      const note = license.note ? ` (${license.note})` : '';
      lines.push(
        lookup('info.licenses.row', [
          license.licenseName,
          String(license.required),
          available,
          String(license.shortfall),
          note,
        ])
      );
    }
    lines.push(lookup('info.permissionSetLicenses.notEvaluated'));
  }
  return lines.join('\n');
};
