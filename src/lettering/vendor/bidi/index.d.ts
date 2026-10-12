export interface EmbeddingLevels {levels:Uint8Array;paragraphs:{start:number;end:number;level:number}[]}
/** Unicode scalar indices, not UTF-16 offsets. */
export function getEmbeddingLevels(text:string,direction?:'auto'|'ltr'|'rtl'):EmbeddingLevels;
export function getReorderedIndices(text:string,levels:EmbeddingLevels,start?:number,end?:number):number[];
export function getBidiCharTypeName(char:string):string;
