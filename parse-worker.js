self.onmessage=async({data})=>{
  try{
    const {buffer,name,delimiter}=data;
    if(buffer.byteLength>10_000_000)throw Error('Maximum file size is 10 MB.');
    let sheets;
    if(/\.xlsx$/i.test(name)){
      const {verifyXlsxPayloads}=await import('./xlsx-guard.js');await verifyXlsxPayloads(buffer);
      importScripts('./vendor/xlsx-0.20.3.min.js');
      const book=XLSX.read(buffer,{type:'array',sheetRows:20002,cellFormula:false,cellHTML:false,cellStyles:false,bookVBA:false});
      if(book.SheetNames.length>20)throw Error('Use a workbook with at most 20 sheets.');
      sheets=book.SheetNames.map(name=>{
        const sheet=book.Sheets[name],ref=sheet['!fullref']||sheet['!ref'];
        if(ref){const range=XLSX.utils.decode_range(ref);if(range.e.r>20000||range.e.c>99)throw Error('Use at most 20,000 data rows and 100 columns.');}
        const rows=XLSX.utils.sheet_to_json(sheet,{header:1,range:0,defval:'',raw:false,blankrows:true});
        if(rows.length&&!rows[0].some(v=>String(v).trim()))throw Error('Put the column headers in row 1 of each non-empty worksheet.');
        return {name,rows};
      });
    }else if(/\.(csv|tsv|txt)$/i.test(name)){
      const {parseDelimited}=await import('./core.js');
      let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('Please export UTF-8 CSV or use XLSX. This text encoding is not supported.');}
      sheets=[{name:'Table',rows:parseDelimited(text,delimiter||(/\.tsv$/i.test(name)?'\t':undefined))}];
    }else throw Error('Choose an XLSX, UTF-8 CSV or TSV file.');
    self.postMessage({sheets});
  }catch(e){self.postMessage({error:e.message});}
};
