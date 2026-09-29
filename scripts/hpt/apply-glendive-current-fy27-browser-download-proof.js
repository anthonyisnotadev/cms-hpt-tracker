'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'), audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-glendive-current-fy27-browser-download-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const file=path.join(audit,'reconciliation-manual-access-observations.json');
const d=JSON.parse(fs.readFileSync(file,'utf8')); const old=d.records.find(r=>r.ccn===p.ccn); if(!old) throw new Error('missing manual observation');
const rec={...old, observed_at:p.observed_at, proof_file:proofName,
  official_pricing_page:p.official_pricing_page, official_page_status:p.official_page_status,
  official_facility_name:p.official_facility_name, official_facility_address:p.official_facility_address,
  page_file_url:p.page_file_url, page_file_http_status:200, page_file_content_type:p.file_content_type,
  page_file_response_bytes:p.file_bytes, page_file_response_sha256:p.file_sha256.replace(/\s/g,''),
  browser_download_result:'Browser download retrieved the complete official-page-linked FY-27 CSV.',
  browser_download_observed_at:p.observed_at, browser_download_bytes:p.file_bytes,
  browser_download_sha256:p.file_sha256.replace(/\s/g,''), browser_download_sample_sha256:p.sample_sha256,
  browser_download_sample_range:p.sample_range, browser_download_row_count:p.row_count_including_header,
  browser_download_headers:p.headers, browser_download_schema_status:p.schema_status,
  latest_current_file_recheck:{observed_at:p.observed_at, page_url:p.official_pricing_page,
    file_url:p.page_file_url, file_status:'retrieved', file_bytes:p.file_bytes,
    file_sha256:p.file_sha256.replace(/\s/g,''), sample_range:p.sample_range,
    sample_sha256:p.sample_sha256, declared_hospital_name:'', declared_address:'',
    declared_last_updated:'', cms_template_version:'', disposition:p.disposition},
  disposition:p.disposition, interpretation:p.interpretation, next_action:p.next_action};
d.records=d.records.filter(r=>r.ccn!==p.ccn); d.records.push(rec); d.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file,JSON.stringify(d,null,2)+'\n');
const browserFile=path.join(audit,'nationwide-browser-reviews.json');
const browser=JSON.parse(fs.readFileSync(browserFile,'utf8'));
const oldBrowser=browser.records.find(r=>r.ccn===p.ccn && r.target===p.page_file_url);
if(!oldBrowser) throw new Error('missing browser review');
const priorBrowser={...oldBrowser};
Object.assign(oldBrowser,{status:'retrieved',http_status:200,bytes_read:p.file_bytes,
  content_type:p.file_content_type,identity:'first-party-page-linked-file-retrieved-metadata-incomplete',
  detail:p.interpretation,browser:'web-search-and-interactive-browser-download',
  observed_at:p.observed_at,full_file_bytes:p.file_bytes,full_file_sha256:p.file_sha256.replace(/\s/g,''),
  sample_range:p.sample_range,sample_sha256:p.sample_sha256,declared_hospital_name:'',
  declared_address:'',declared_last_updated:'',cms_template_version:'',
  next_action:p.next_action,prior_access_observation:priorBrowser});
browser.updated_at=p.observed_at;
fs.writeFileSync(browserFile,JSON.stringify(browser,null,2)+'\n');
console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition,file_bytes:p.file_bytes},null,2));
