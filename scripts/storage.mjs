import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SITE_LIMIT=1_000_000_000;
function filesUnder(root){if(!fs.existsSync(root))return [];return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(path.join(root,e.name)):[path.join(root,e.name)]);}
export function finalizeStorage(root){
  const reportFile=path.join(root,'storage.json');
  const files=filesUnder(root).filter(f=>f!==reportFile);
  const references=files.filter(f=>/\.(html|xml|css|js|json)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
  const covers=filesUnder(path.join(root,'media/covers'));
  let removed=0;
  for(const file of covers){
    const relative='/'+path.relative(root,file).split(path.sep).join('/');
    if(!references.includes(relative)){fs.unlinkSync(file);removed++;}
  }
  const remaining=filesUnder(root).filter(f=>f!==reportFile);
  const coverFiles=remaining.filter(f=>f.startsWith(path.join(root,'media/covers')+path.sep));
  for(const file of coverFiles)if(fs.statSync(file).size>200*1024)throw new Error(`Обложка больше 200 КБ: ${path.basename(file)}. Подготовьте её в редакторе.`);
  const sum=arr=>arr.reduce((n,f)=>n+fs.statSync(f).size,0);
  const bytes=sum(remaining);
  const report={siteBytes:bytes,limitBytes:SITE_LIMIT,coverBytes:sum(coverFiles),coverCount:coverFiles.length};
  // Account for the small report itself without recursive accumulation between builds.
  for(let i=0;i<3;i++)report.siteBytes=bytes+Buffer.byteLength(JSON.stringify(report));
  if(report.siteBytes>SITE_LIMIT)throw new Error('Сборка сайта превышает 1 ГБ. Уменьшите объём файлов перед публикацией.');
  fs.writeFileSync(reportFile,JSON.stringify(report));
  console.log(`Site: ${(report.siteBytes/1_000_000).toFixed(2)} MB / 1000 MB; ${coverFiles.length} covers; ${removed} unused cover files excluded from deployment.`);
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))finalizeStorage(path.resolve('dist'));
