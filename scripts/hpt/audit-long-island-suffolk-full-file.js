'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path'),childProcess=require('child_process');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const prior=JSON.parse(fs.readFileSync(path.join(audit,'reconciliation-long-island-suffolk-proof.json'),'utf8')).records[0];
if(prior.ccn!=='330141'||!prior.mrf_url||!prior.mrf_content_length)throw Error('Missing bounded Suffolk proof');
(async()=>{const observedAt=new Date().toISOString();let response,stream,transport='fetch',curlExit;
try{response=await fetch(prior.mrf_url);if(!response.ok||!response.body)throw Error(`Full file request failed: ${response.status}`);stream=response.body;}catch(error){transport='curl-after-fetch-connect-timeout';const child=childProcess.spawn('curl.exe',['-L','--fail','--silent','--show-error','--max-time','600',prior.mrf_url],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>{if(stderr.length<4096)stderr+=chunk});stream=child.stdout;curlExit=new Promise((resolve,reject)=>child.on('error',reject).on('close',code=>code===0?resolve():reject(new Error(`curl exited ${code}: ${stderr}`))));}
const expectedLength=Number(response?.headers.get('content-length')||prior.mrf_content_length),hash=crypto.createHash('sha256');
let bytes=0,rows=0,fields=1,inQuotes=false,pendingQuote=false,malformed=false,metadataColumns=0,dataColumns=0,mismatchedDataRows=0,minDataColumns=Infinity,maxDataColumns=0;
const firstRowCounts=[];
function finishRow(){rows++;firstRowCounts.length<4&&firstRowCounts.push(fields);if(rows===1)metadataColumns=fields;if(rows===2&&fields!==metadataColumns)malformed=true;if(rows===3)dataColumns=fields;if(rows>3){minDataColumns=Math.min(minDataColumns,fields);maxDataColumns=Math.max(maxDataColumns,fields);if(fields!==dataColumns)mismatchedDataRows++;}fields=1;}
for await(const chunk of stream){hash.update(chunk);bytes+=chunk.length;for(const b of chunk){if(inQuotes){if(pendingQuote){if(b===34){pendingQuote=false;continue}inQuotes=false;pendingQuote=false;if(b===44){fields++;continue}if(b===10){finishRow();continue}if(b===13)continue;malformed=true;continue}if(b===34)pendingQuote=true;continue}if(b===34){inQuotes=true;continue}if(b===44){fields++;continue}if(b===10){finishRow();continue}if(b===13)continue;}}
if(curlExit)await curlExit;
if(pendingQuote){inQuotes=false;pendingQuote=false}if(inQuotes)malformed=true;if(fields>1)finishRow();
const proof={ccn:prior.ccn,observed_at:observedAt,mrf_url:prior.mrf_url,http_status:response?.status||200,transport,content_length_header:expectedLength,bytes,sha256:hash.digest('hex'),etag:response?.headers.get('etag')||prior.mrf_etag||'',rows,first_row_column_counts:firstRowCounts,metadata_columns:metadataColumns,data_columns:dataColumns,min_data_columns:Number.isFinite(minDataColumns)?minDataColumns:0,max_data_columns:maxDataColumns,mismatched_data_rows:mismatchedDataRows,unterminated_quote:inQuotes,structurally_consistent:!malformed&&bytes===expectedLength&&rows>3&&mismatchedDataRows===0};
if(!proof.structurally_consistent)throw Error(`Structural audit failed: ${JSON.stringify(proof)}`);
fs.writeFileSync(path.join(audit,'reconciliation-long-island-suffolk-full-file-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
