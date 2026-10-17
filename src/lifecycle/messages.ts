const TEXT: Record<string, string> = {
  errorInvalidJson: 'Failed to parse JSON file %s: %s',
  errorInvalidPersonaDefinition: 'persona-def.json must contain a personas object.',
  errorPersonasWithoutDefinition: 'User "%s" lists personas but no --personas-def was supplied.',
  errorInvalidAgainstMatchField: 'Invalid against match field "%s".',
  errorInvalidUserValue: 'Invalid --user value "%s". Expected field:value.',
  errorInvalidAgainstValue: 'Invalid --against value "%s". Expected field:value.',
  errorInvalidUserMatchField: 'Invalid user match field "%s".',
  errorPersonaSourceRequiresUsers: 'Persona source "%s" requires a users definition so held personas are known.',
  errorPersonaSourceUnsupported:
    'Persona source "%s" is not supported by warden-core; the caller must provide held personas.',
  errorDuplicateExternalIdMatch: 'Multiple users matched %s="%s".',
  errorPromptDeclined: 'Operation cancelled.',
  warningPromptTimeout: 'Warning confirmation timed out after 10 seconds.',
  warningMissingUserLogin: 'No UserLogin row was found for this user.',
  promptContinue: 'Continue with this operation?',
};

export const lifecycleMessage = (code: string, args: string[] = []): string => {
  const template = TEXT[code] ?? code;
  let index = 0;
  return template.replaceAll('%s', () => args[index++] ?? '');
};
