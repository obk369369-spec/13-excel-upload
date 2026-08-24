(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.Tool13BatchState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  const SCHEMA_VERSION = 1;

  function text(value){
    return value === undefined || value === null ? '' : String(value);
  }

  function rowKey(row){
    const keys = Object.keys(row || {}).filter(key => key !== '_tool13_row_key').sort();
    return keys.map(key => `${key}=${text(row[key]).trim()}`).join('\u001f');
  }

  function emptySnapshot(){
    return {schema_version:SCHEMA_VERSION, files:[], headers:[], rows:[], batches:0, duplicate_rows:0};
  }

  function normalizeSnapshot(value){
    const source = value && (value.schema_version === undefined || value.schema_version === SCHEMA_VERSION)
      ? value : emptySnapshot();
    return {
      schema_version: SCHEMA_VERSION,
      files: Array.from(new Set(Array.isArray(source.files) ? source.files.map(text) : [])),
      headers: Array.from(new Set(Array.isArray(source.headers) ? source.headers.map(text).filter(Boolean) : [])),
      rows: Array.isArray(source.rows) ? source.rows.map(row => ({...row})) : [],
      batches: Number.isInteger(source.batches) ? source.batches : 0,
      duplicate_rows: Number.isInteger(source.duplicate_rows) ? source.duplicate_rows : 0
    };
  }

  function mergeBatch(current, batch){
    const next = normalizeSnapshot(current);
    const incoming = normalizeSnapshot({...batch, schema_version:SCHEMA_VERSION});
    next.files = Array.from(new Set([...next.files, ...incoming.files]));
    next.headers = Array.from(new Set([...next.headers, ...incoming.headers]));
    const seen = new Set(next.rows.map(rowKey));
    for(const row of incoming.rows){
      const key = rowKey(row);
      if(seen.has(key)){
        next.duplicate_rows++;
        continue;
      }
      seen.add(key);
      next.rows.push({...row, _tool13_row_key:key});
    }
    next.batches++;
    return next;
  }

  function serialize(snapshot){
    return JSON.stringify(normalizeSnapshot(snapshot));
  }

  function restore(raw){
    if(!raw) return emptySnapshot();
    try { return normalizeSnapshot(JSON.parse(raw)); }
    catch (_) { return emptySnapshot(); }
  }

  return {SCHEMA_VERSION, emptySnapshot, mergeBatch, serialize, restore, rowKey};
});
