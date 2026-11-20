import {aiSearch,searchInstructions,sanitize,FILTER_SCHEMA} from '../src/ai.js';
import {isLang} from '../src/i18n.js';
export const WORKERS_AI_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Validate the schema locally too: JSON mode is not a guarantee of correct model output.
function matches(schema,value) {
  if(schema.anyOf) return schema.anyOf.some(s=>matches(s,value));
  if(schema.enum && !schema.enum.includes(value)) return false;
  switch(schema.type) {
    case 'null': return value===null;
    case 'string': return typeof value==='string';
    case 'number': return typeof value==='number' && Number.isFinite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'array': return Array.isArray(value) && value.every(v=>matches(schema.items,v));
    case 'object': return value!==null && typeof value==='object' && !Array.isArray(value)
      && (schema.required||[]).every(k=>Object.hasOwn(value,k))
      && Object.keys(value).every(k=>Object.hasOwn(schema.properties,k) ? matches(schema.properties[k],value[k]) : schema.additionalProperties!==false);
    default: return false;
  }
}
export function makeWorkersAiSearch(binding,{model=WORKERS_AI_MODEL,fallback=aiSearch,timeoutMs=30000}={}) {
  return async function(query,lang='es') {
    lang=isLang(lang)?lang:'es';
    const text=String(query||'').slice(0,500).trim();
    if(!text) throw new Error('Escribe qué buscas.');
    let timer;
    try {
      if(!binding?.run) throw new Error('Workers AI no está enlazado.');
      const result=await Promise.race([
        binding.run(model,{
          messages:[{role:'system',content:searchInstructions(lang)+' Devuelve solo el objeto JSON de filtros solicitado.'},{role:'user',content:text}],
          max_tokens:2048,temperature:0.1,stream:false,
          response_format:{type:'json_schema',json_schema:FILTER_SCHEMA}
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La IA tarda demasiado.')),timeoutMs);})
      ]);
      const filters=typeof result?.response==='string'?JSON.parse(result.response):result?.response;
      if(!matches(FILTER_SCHEMA,filters)) throw new Error('Filtros de IA inválidos.');
      return {...sanitize(filters),source:'workers-ai'};
    } catch {
      console.error('[workers-ai] No se pudo interpretar la búsqueda; se usa el intérprete alternativo.');
      return fallback(text,lang);
    } finally {clearTimeout(timer);}
  };
}
