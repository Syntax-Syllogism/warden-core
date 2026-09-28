import { renderMessages } from '../renderMessages.js';
import type { AccessTargetType, AssignmentType, UserAccessResult, UserAccessRow } from './types.js';

const baseColumns = [
  'userId',
  'userName',
  'username',
  'assignmentType',
  'sourceId',
  'sourceName',
  'viaPermissionSetId',
  'viaPermissionSetName',
  'targetType',
  'targetName',
  'sourceApiName',
  'sourceLabel',
] as const;

export const fieldCsvColumns = (): string[] => [...baseColumns, 'read', 'edit'];
export const enabledCsvColumns = (): string[] => [...baseColumns, 'enabled'];
export const tabCsvColumns = (): string[] => [...baseColumns, 'visibility'];
export const recordTypeCsvColumns = (): string[] => [...baseColumns, 'visible', 'default'];
export const objectCsvColumns = (): string[] => [
  ...baseColumns,
  'read',
  'create',
  'edit',
  'delete',
  'viewAll',
  'modifyAll',
];

const csvValue = (row: UserAccessRow, column: string): unknown => {
  if (column in row.access) return row.access[column as keyof typeof row.access];
  return row[column as keyof UserAccessRow] ?? '';
};

export const flattenAccessRow = (row: UserAccessRow, columns: string[]): Record<string, unknown> =>
  Object.fromEntries(columns.map((column) => [column, csvValue(row, column)]));

const formatVia = (assignmentType: AssignmentType, sourceName: string, viaName?: string): string => {
  if (assignmentType === 'Profile') return `Profile: ${sourceName}`;
  if (assignmentType === 'PermissionSet') return `Permission Set: ${sourceName}`;
  return viaName ? `PSG: ${sourceName} / PS: ${viaName}` : `PSG: ${sourceName}`;
};

const paddedTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((header, idx) => Math.max(header.length, ...rows.map((row) => (row[idx] ?? '').length)));
  const render = (cells: string[]): string =>
    cells
      .map((cell, idx) => cell.padEnd(widths[idx]))
      .join('  ')
      .trimEnd();
  return [render(headers), ...rows.map(render)].join('\n');
};

export const renderFieldTable = (rows: UserAccessRow[], showTarget = false): string =>
  paddedTable(
    [...(showTarget ? ['Target'] : []), 'User Name', 'Username', 'Read', 'Edit', 'Via'],
    rows.map((row) => {
      if (row.access.kind !== 'field') throw new Error('Field table received non-field access');
      return [
        ...(showTarget ? [row.targetName] : []),
        row.userName,
        row.username,
        row.access.read ? 'yes' : 'no',
        row.access.edit ? 'yes' : 'no',
        formatVia(row.assignmentType, row.sourceName, row.viaPermissionSetName),
      ];
    })
  );

export const renderObjectTable = (rows: UserAccessRow[]): string =>
  paddedTable(
    ['User Name', 'Username', 'R', 'C', 'E', 'D', 'VA', 'MA', 'Via'],
    rows.map((row) => {
      if (row.access.kind !== 'object') throw new Error('Object table received non-object access');
      const access = row.access;
      return [
        row.userName,
        row.username,
        access.read ? 'Y' : 'N',
        access.create ? 'Y' : 'N',
        access.edit ? 'Y' : 'N',
        access.delete ? 'Y' : 'N',
        access.viewAll ? 'Y' : 'N',
        access.modifyAll ? 'Y' : 'N',
        formatVia(row.assignmentType, row.sourceName, row.viaPermissionSetName),
      ];
    })
  );

export const renderEnabledTable = (rows: UserAccessRow[]): string =>
  paddedTable(
    ['User Name', 'Username', 'Enabled', 'Via'],
    rows.map((row) => {
      if (row.access.kind !== 'enabled') throw new Error('Enabled table received non-enabled access');
      return [
        row.userName,
        row.username,
        row.access.enabled ? 'yes' : 'no',
        formatVia(row.assignmentType, row.sourceName, row.viaPermissionSetName),
      ];
    })
  );

export const renderTabTable = (rows: UserAccessRow[]): string =>
  paddedTable(
    ['User Name', 'Username', 'Visibility', 'Via'],
    rows.map((row) => {
      if (row.access.kind !== 'tab') throw new Error('Tab table received non-tab access');
      return [
        row.userName,
        row.username,
        row.access.visibility,
        formatVia(row.assignmentType, row.sourceName, row.viaPermissionSetName),
      ];
    })
  );

export const renderRecordTypeTable = (rows: UserAccessRow[]): string =>
  paddedTable(
    ['User Name', 'Username', 'Visible', 'Default', 'Via'],
    rows.map((row) => {
      if (row.access.kind !== 'record-type') throw new Error('Record type table received non-record-type access');
      return [
        row.userName,
        row.username,
        row.access.visible ? 'yes' : 'no',
        row.access.default === null ? 'n/a' : row.access.default ? 'yes' : 'no',
        formatVia(row.assignmentType, row.sourceName, row.viaPermissionSetName),
      ];
    })
  );

const stableOrder = (rows: UserAccessRow[]): UserAccessRow[] =>
  [...rows].sort(
    (a, b) =>
      a.userName.localeCompare(b.userName) ||
      a.userId.localeCompare(b.userId) ||
      a.targetName.localeCompare(b.targetName) ||
      a.assignmentType.localeCompare(b.assignmentType) ||
      a.sourceName.localeCompare(b.sourceName) ||
      (a.viaPermissionSetName ?? '').localeCompare(b.viaPermissionSetName ?? '') ||
      JSON.stringify(a.access).localeCompare(JSON.stringify(b.access)) ||
      a.sourceId.localeCompare(b.sourceId) ||
      (a.viaPermissionSetId ?? '').localeCompare(b.viaPermissionSetId ?? '')
  );

const targetLabels: Record<AccessTargetType, string> = {
  field: 'Field',
  object: 'Object',
  'apex-class': 'Apex Class',
  'vf-page': 'Visualforce Page',
  'custom-permission': 'Custom Permission',
  tab: 'Tab',
  'record-type': 'Record Type',
};

export const renderAccessResult = (result: UserAccessResult, userLabel?: string): string => {
  const sortedRows = stableOrder(result.rows);
  const grants = `Profiles: ${result.stats.profileGrants} | Permission Sets: ${result.stats.permissionSetGrants} | Permission Set Groups: ${result.stats.permissionSetGroupGrants}`;
  const lines = userLabel
    ? [`Access for ${userLabel}: ${result.targetName}`, `Accessible grants: ${sortedRows.length}`, grants]
    : [
        `${targetLabels[result.targetType]}: ${result.targetName}`,
        `Active users with access: ${result.stats.totalActiveUsersWithAccess}`,
        grants,
      ];
  if (result.warnings.length > 0) {
    lines.push('');
    for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  }
  if (sortedRows.length > 0) {
    lines.push('');
    if (result.targetType === 'field')
      lines.push(renderFieldTable(sortedRows, Boolean(userLabel && !result.fieldApiName)));
    else if (result.targetType === 'object') lines.push(renderObjectTable(sortedRows));
    else if (result.targetType === 'tab') lines.push(renderTabTable(sortedRows));
    else if (result.targetType === 'record-type') lines.push(renderRecordTypeTable(sortedRows));
    else lines.push(renderEnabledTable(sortedRows));
  } else if (result.warnings.length === 0) {
    lines.push('', renderMessages(userLabel ? 'info.noUserResults' : 'info.noResults'));
  }
  return lines.join('\n');
};
