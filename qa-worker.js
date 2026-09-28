self.onmessage=async({data})=>{
  try{
    const mod=await import(data.pro?'./api/pro.js?check='+Date.now():'./core.js');
    const fn=data.pro?mod.run:mod.analyze;
    if(!data.pro&&data.segments.length>100)throw Error('Free checks support up to 100 segments.');
    self.postMessage({result:fn(data.segments,data.options)});
  }catch(e){self.postMessage({error:e.message.includes('module')?'Pro access needs to be unlocked again. Your files are still here.':e.message});}
};
