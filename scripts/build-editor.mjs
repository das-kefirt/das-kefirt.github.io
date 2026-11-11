// A separate deliverable. Never write this file inside the Pages artifact.
import fs from 'node:fs/promises';
import { build } from 'vite';
const read = path => fs.readFile(path,'utf8');
const results = await build({
  configFile:false, publicDir:false,
  build:{write:false,target:'es2022',lib:{entry:'src/private-editor/main.js',formats:['iife'],name:'KefirtEditor'},
    rolldownOptions:{output:{codeSplitting:false}}}
});
const chunks = [results].flat().flatMap(result=>result.output);
if(chunks.length!==1 || chunks[0].type!=='chunk') throw new Error('Expected a self-contained editor bundle');
const styles=await read("src/styles/global.css")+"\n"+await read("src/styles/editor.css");
const notes=await read("src/components/note-popover.html");
const html=(await read('src/private-editor/template.html'))
  .replace('/*STYLE*/',()=>styles)
  .replace('<!--NOTES-->',()=>notes)
  .replace('/*APP*/',()=>chunks[0].code.replace(/<\/script/gi,'<\\/script'));
await fs.mkdir('local-editor',{recursive:true});
await fs.writeFile('local-editor/das-kefirt-editor.html',html);
