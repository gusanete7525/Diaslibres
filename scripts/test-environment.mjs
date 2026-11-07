// Tests use local fixtures. Never pass the VPS's provider keys or production URLs to them.
// Preserve only the environment needed to launch Node/npm on supported operating systems.
export function testEnvironment(source=process.env) {
  const allowed=['PATH','Path','HOME','USER','LOGNAME','SHELL','TMPDIR','TMP','TEMP',
    'LANG','LC_ALL','TZ','SystemRoot','SYSTEMROOT','ComSpec','PATHEXT','WINDIR',
    'NPM_CONFIG_CACHE','npm_config_cache','NO_COLOR','FORCE_COLOR'];
  return {...Object.fromEntries(allowed.filter(k=>source[k]!==undefined).map(k=>[k,source[k]])),NODE_ENV:'test'};
}
