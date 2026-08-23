export function serializeBatch(job) {
  if (!job) return null;
  const {
    inputPath: _inputPath,
    resultPath: _resultPath,
    errorPath: _errorPath,
    inputFileContent: _inputFileContent,
    outputFileUrl: _outputFileUrl,
    errorFileUrl: _errorFileUrl,
    ...safe
  } = job;
  return safe;
}
