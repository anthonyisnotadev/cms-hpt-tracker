const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const rows=[
 {ccn:'040119',loc:'White River Health|White River Medical Center',addr:'1710 Harrison St, Batesville AR 72501, Batesville, AR 72501|1710 Harrison St, Batesville, ARKANSAS 72501',lic:'000418',npi:'1710943881',url:'https://whiteriverhealth.slicedhealth.io/pricer/71-0411459-1710943881_WhiteRiverHealth_standardcharges.CSV',bytes:44197075,sha:'399c1953164ac0eb81d9b279e2d55a3a1cf497f2f2fb1ae08fd4039ca64ff9d2'},
 {ccn:'041310',loc:'White River Health|Stone County Medical Center',addr:'1710 Harrison St, Batesville, AR 72501, Batesville, AR 72501|2106 East Main Street, Mountain View, ARKANSAS 72560',lic:'AR5036',npi:'1417913419',url:'https://whiteriverhealth.slicedhealth.io/pricer/71-0411459-1417913419_WhiteRiverHealth_standardcharges.CSV',bytes:42785238,sha:'3a9220734c7735e92f8084d125bccf5149187fe928f22330ad4b5eebd33e863d'}
];
const pointer='https://whiteriverhealth.org/cms-hpt.txt',observed='2026-09-26T20:45:00Z';
const mp=path.join(audit,'reconciliation-manual-access-observations.json'),m=JSON.parse(fs.readFileSync(mp,'utf8'));
for(const r of rows){
 const proofName=`reconciliation-whiteriver-${r.ccn}-current-pointer-proof-2026-09-26.json`;
 const p={ccn:r.ccn,official_domain:'https://whiteriverhealth.org/',source_page_url:'https://whiteriverhealth.slicedhealth.io/home',pointer_url:pointer,pointer_status:200,mrf_url:r.url,mrf_status:200,declared_hospital_name:'White River Health',declared_location_name:r.loc,declared_address:r.addr,declared_license_state:'AR',declared_last_updated:'2026-03-19',cms_template_version:'3.0.0',file_kind:'csv',mrf_total_bytes:r.bytes,mrf_sha256:r.sha,declared_attestation:true,observed_at:observed,identity_basis:'current-root-pointer-exact-file-header-name-location-address-state-date-version-license-npi'};
 fs.writeFileSync(path.join(audit,proofName),JSON.stringify(p,null,2)+'\n');
 m.records=m.records.filter(x=>x.ccn!==r.ccn);
 m.records.push({...p,proof_file:proofName,facility_file_url:r.url,file_range_status:'complete-200-streamed',file_sample_bytes:r.bytes,file_sample_sha256:r.sha,attestation:true,manual_identity_gate:'recorded-file-name-location-street-state-date-template-attestation-license-npi-agree',disposition:'verified-current-mrf',next_action:'Retain and recheck the shared pointer; facility-specific files and identity metadata agree.'});
}
m.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(mp,JSON.stringify(m,null,2)+'\n');
console.log(JSON.stringify({applied:rows.map(r=>r.ccn),count:rows.length},null,2));
