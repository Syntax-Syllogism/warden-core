const TEXT: Record<string, string> = {
  errorUnsupportedAccessType: 'Unsupported access type: %s.',
  errorInvalidTarget: 'Invalid target value: %s.',
  errorFieldTargetMustBeQualified: 'Field target must be qualified as ObjectApiName.FieldApiName: %s.',
  errorObjectNotFound: 'Object not found: %s.',
  errorFieldNotFound: 'Object %s does not have field %s.',
  errorApexClassNotFound: 'Apex class not found: %s.',
  errorVisualforcePageNotFound: 'Visualforce page not found: %s.',
  errorCustomPermissionNotFound: 'Custom permission not found: %s.',
  errorTabNotFound: 'Tab not found: %s.',
  errorRecordTypeTargetMustBeQualified:
    'Record type target must be qualified as SObject.DeveloperName for an active, non-master record type: %s.',
  errorMasterRecordTypeUnsupported:
    'The Master record type is not supported. Specify an active non-master record type as SObject.DeveloperName: %s.',
  errorRecordTypeNotFound: 'Record type not found or ambiguous: %s.',
  errorRecordTypeAmbiguous: 'Record type target matched multiple records and cannot be selected safely: %s.',
  errorRecordTypeInactive: 'Record type is inactive: %s.',
  errorRecordTypeMetadataReadFailed:
    'Unable to read complete %s metadata for record-type access audit (%s). No partial audit result was returned. Record-type auditing reads every profile and permission set through the Metadata API, so the authenticated user needs org-wide metadata read access. Grant these system permissions: "API Enabled", "View Setup and Configuration", and either "Modify Metadata Through Metadata API Functions" or "Modify All Data". On large orgs a user missing "Modify All Data" (or the granular "Modify Metadata" permission) is silently served an incomplete metadata set rather than an error, which is the usual cause of this failure.',
  errorAccessQueryFailed: 'Failed to resolve access for %s target %s.',
};

export const accessMessage = (code: string, args: string[] = []): string => {
  const template = TEXT[code] ?? code;
  let index = 0;
  return template.replaceAll('%s', () => args[index++] ?? '');
};
