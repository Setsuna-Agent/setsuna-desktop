/** Validate the SemVer 2.0.0 grammar without a backtracking regular expression. */
export function isValidSemver(value) {
  if (typeof value !== 'string' || value.length === 0) return false;

  const buildSeparator = value.indexOf('+');
  if (buildSeparator >= 0 && value.indexOf('+', buildSeparator + 1) >= 0) return false;
  const releaseAndPrerelease = buildSeparator < 0 ? value : value.slice(0, buildSeparator);
  const build = buildSeparator < 0 ? null : value.slice(buildSeparator + 1);
  if (build !== null && !validIdentifiers(build, false)) return false;

  const prereleaseSeparator = releaseAndPrerelease.indexOf('-');
  const release = prereleaseSeparator < 0
    ? releaseAndPrerelease
    : releaseAndPrerelease.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator < 0
    ? null
    : releaseAndPrerelease.slice(prereleaseSeparator + 1);

  const releaseIdentifiers = release.split('.');
  if (releaseIdentifiers.length !== 3 || !releaseIdentifiers.every(validNumericIdentifier)) return false;
  return prerelease === null || validIdentifiers(prerelease, true);
}

function validIdentifiers(value, rejectNumericLeadingZero) {
  return value.split('.').every((identifier) => (
    validIdentifier(identifier)
    && (!rejectNumericLeadingZero || !isNumeric(identifier) || validNumericIdentifier(identifier))
  ));
}

function validNumericIdentifier(identifier) {
  return isNumeric(identifier) && (identifier.length === 1 || identifier[0] !== '0');
}

function isNumeric(identifier) {
  if (identifier.length === 0) return false;
  for (const character of identifier) {
    if (character < '0' || character > '9') return false;
  }
  return true;
}

function validIdentifier(identifier) {
  if (identifier.length === 0) return false;
  for (const character of identifier) {
    const alphaNumeric = (character >= '0' && character <= '9')
      || (character >= 'A' && character <= 'Z')
      || (character >= 'a' && character <= 'z');
    if (!alphaNumeric && character !== '-') return false;
  }
  return true;
}
