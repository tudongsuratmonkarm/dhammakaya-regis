import { ok, errorResponse } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { getSheetValues } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';
export const handler = async()=>{try{await getSheetValues(SHEETS.SETTINGS,'A1:C2');return ok({status:'ok',sheets:'connected',time:new Date().toISOString()});}catch(error){console.error(error);return errorResponse(error);}};
export default netlify(handler);
