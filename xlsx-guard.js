// Check ZIP metadata before the spreadsheet parser allocates expanded XML buffers.
export function inspectXlsx(buffer){
  const v=new DataView(buffer),n=v.byteLength;
  if(n<22)throw Error('This is not a valid XLSX workbook.');
  let end=-1;
  for(let p=n-22;p>=Math.max(0,n-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===n){end=p;break;}
  if(end<0)throw Error('The XLSX ZIP directory is missing or damaged.');
  const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||count!==v.getUint16(end+8,true)||count===65535||size===0xffffffff||start===0xffffffff||start+size>end||count>2000)throw Error('This workbook uses an unsupported or oversized ZIP layout.');
  let p=start,total=0;const payloads=[];
  for(let i=0;i<count;i++){
    if(p+46>start+size||v.getUint32(p,true)!==0x02014b50)throw Error('The workbook ZIP directory is damaged.');
    const flags=v.getUint16(p+8,true),expanded=v.getUint32(p+24,true);
    total+=expanded;
    if(flags&1)throw Error('Password-protected workbooks are not supported.');
    if(expanded>20_000_000||total>40_000_000)throw Error('Expanded workbook data exceeds 40 MB total or 20 MB per entry. Export a smaller CSV.');
    const compressed=v.getUint32(p+20,true),offset=v.getUint32(p+42,true),method=v.getUint16(p+10,true),nameSize=v.getUint16(p+28,true);
    if(offset+30>start||v.getUint32(offset,true)!==0x04034b50||![0,8].includes(method)||v.getUint16(offset+8,true)!==method)throw Error('The workbook ZIP entry is damaged or unsupported.');
    const localName=v.getUint16(offset+26,true),dataStart=offset+30+localName+v.getUint16(offset+28,true);
    if(localName!==nameSize||dataStart+compressed>start||p+46+nameSize>start+size)throw Error('The workbook ZIP entry is inconsistent.');
    for(let j=0;j<nameSize;j++)if(v.getUint8(offset+30+j)!==v.getUint8(p+46+j))throw Error('The workbook ZIP entry names disagree.');
    if(!(flags&8)&&(v.getUint32(offset+18,true)!==compressed||v.getUint32(offset+22,true)!==expanded))throw Error('The workbook ZIP entry sizes disagree.');
    payloads.push({start:dataStart,end:dataStart+compressed,method,expanded});
    p+=46+v.getUint16(p+28,true)+v.getUint16(p+30,true)+v.getUint16(p+32,true);
    if(p>start+size)throw Error('The workbook ZIP directory is damaged.');
  }
  if(p!==start+size)throw Error('The workbook ZIP directory is inconsistent.');
  return {entries:count,expandedBytes:total,payloads};
}
export async function verifyXlsxPayloads(buffer){
  const report=inspectXlsx(buffer);let total=0;
  for(const entry of report.payloads){
    const data=new Blob([new Uint8Array(buffer,entry.start,entry.end-entry.start)]);let size=0;
    const stream=entry.method===8?data.stream().pipeThrough(new DecompressionStream('deflate-raw')):data.stream();
    const reader=stream.getReader();
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;total+=value.byteLength;if(size>entry.expanded||size>20_000_000||total>40_000_000)throw Error('Expanded workbook data exceeds its declared size. Export a smaller CSV.');}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(size!==entry.expanded)throw Error('The workbook ZIP payload size is inconsistent.');
  }
  return report;
}
