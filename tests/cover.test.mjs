import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MAX_COVER_BYTES,TARGET_COVER_BYTES,coverDimensions,fitCover,validateCover,validateCoverAsset,bytesToBase64,digestHex} from '../src/lib/cover.mjs';
import {serializeArticle,deserializeArticle,publishArticle} from '../src/lib/editor-core.mjs';
import {parseArticle} from '../src/lib/content.mjs';
import {finalizeStorage} from '../scripts/storage.mjs';

// Synthetic WebP envelope tests transport/integrity, not image decoding.
async function fixture(){
  const bytes=new TextEncoder().encode('RIFF0000WEBPsynthetic-transport-test');
  const src=`/media/covers/${await digestHex('SHA-256',bytes)}.webp`;
  const cover={src,width:1800,height:600,bytes:bytes.length,alt:'Описание',caption:'Автор'};
  return {cover,asset:{src,base64:bytesToBase64(bytes)},bytes};
}
const article=cover=>({title:'Обложка',slug:'cover-test',description:'Проверка',author:'Автор',date:'2026-10-18',section:'essays',body:'Текст.',notes:[],bibliography:[],tags:[],cover});

test('Resizing preserves proportions and never enlarges a small source',()=>{
  assert.deepEqual(coverDimensions(3600,1200),{width:1800,height:600});
  assert.deepEqual(coverDimensions(600,200),{width:600,height:200});
  assert.deepEqual(coverDimensions(1200,3600),{width:400,height:1200});
});
test('Compression prefers the target budget and enforces a hard cap without PNG fallback',async()=>{
  const calls=[];const result=await fitCover(3600,1200,async(size,q)=>{calls.push([size,q]);return new Blob([new Uint8Array(q>.7?180*1024:100*1024)],{type:'image/webp'});});
  assert.ok(result.blob.size<=TARGET_COVER_BYTES);assert.equal(result.width,1800);assert.equal(calls.length,3);
  await assert.rejects(fitCover(1800,600,async()=>new Blob([new Uint8Array(MAX_COVER_BYTES+1)],{type:'image/webp'})),/сжать/);
  await assert.rejects(fitCover(1800,600,async()=>new Blob(['PNG'],{type:'image/png'})),/не поддерживает/);
});
test('Draft carries cover bytes; publication contains only validated metadata and file path',async()=>{
  const {cover,asset,bytes}=await fixture();
  assert.deepEqual(await validateCoverAsset(cover,asset),bytes);
  const raw=serializeArticle({...article(cover),_cover:asset},false);
  assert.equal(deserializeArticle(raw)._cover.base64,asset.base64);
  const published=serializeArticle({...article(cover),_cover:asset},true);
  assert.doesNotMatch(published,/_cover|base64/);
  assert.deepEqual(parseArticle(published,'cover-test.md').cover,cover);
  assert.throws(()=>validateCover({...cover,src:'https://example.org/image.png'}),/Некорректная/);
  assert.throws(()=>validateCover({...cover,bytes:MAX_COVER_BYTES+1}),/200/);
  await assert.rejects(validateCoverAsset({...cover,bytes:cover.bytes+1},asset),/повреждён/);
});

async function publishingFixture(existing=false,race=false){
  const {cover,asset,bytes}=await fixture();const calls=[];
  const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`),combined=new Uint8Array(prefix.length+bytes.length);combined.set(prefix);combined.set(bytes,prefix.length);
  const blobSha=await digestHex('SHA-1',combined);
  const fetcher=async(url,opts)=>{
    const u=new URL(url),p=u.pathname.replace('/repos/das-kefirt/das-kefirt.github.io','');
    const body=opts.body?JSON.parse(opts.body):null;calls.push({p,method:opts.method,body,query:u.search});
    if(p==='/git/ref/heads/main')return Response.json({object:{sha:'head'}});
    if(p==='/contents/src/content/posts/cover-test.md')return new Response('',{status:404});
    if(p==='/git/commits/head')return Response.json({tree:{sha:'base-tree'}});
    if(p===`/contents/public${cover.src}`)return existing?Response.json({type:'file',size:bytes.length,sha:blobSha}):new Response('',{status:404});
    if(p==='/git/blobs')return Response.json({sha:blobSha});
    if(p==='/git/trees')return Response.json({sha:'new-tree'});
    if(p==='/git/commits')return Response.json({sha:'new-commit'});
    if(p==='/git/refs/heads/main')return race?new Response('',{status:409}):Response.json({object:{sha:'new-commit'}});
    throw new Error('Unexpected request '+p);
  };
  return {cover,asset,calls,fetcher};
}
test('Image and article publish in one commit; no inline data or original image reaches the article',async()=>{
  const {cover,asset,calls,fetcher}=await publishingFixture();
  const result=await publishArticle({article:article(cover),coverAsset:asset,token:'test-token',fetcher});
  assert.match(result.content.sha,/^[a-f0-9]{40}$/);
  const tree=calls.find(c=>c.p==='/git/trees').body;
  assert.equal(tree.base_tree,'base-tree');assert.equal(tree.tree.length,2);
  assert.doesNotMatch(tree.tree[0].content,/_cover|base64|test-token/);
  assert.equal(tree.tree[1].path,`public${cover.src}`);
  assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
  assert.deepEqual(calls.at(-1).body,{sha:'new-commit',force:false});
});
test('Identical cover is reused; branch race fails without force or an extra image commit',async()=>{
  const existing=await publishingFixture(true);
  await publishArticle({article:article(existing.cover),coverAsset:existing.asset,token:'test-token',fetcher:existing.fetcher});
  assert.equal(existing.calls.filter(c=>c.p==='/git/blobs').length,0);
  assert.equal(existing.calls.find(c=>c.p==='/git/trees').body.tree.length,1);
  const race=await publishingFixture(false,true);
  await assert.rejects(publishArticle({article:article(race.cover),coverAsset:race.asset,token:'test-token',fetcher:race.fetcher}),/изменился/);
  assert.equal(race.calls.filter(c=>c.p==='/git/commits'&&c.method==='POST').length,1);
  assert.equal(race.calls.at(-1).body.force,false);
});
test('A missing cover without local bytes cannot publish a broken page',async()=>{
  const f=await publishingFixture();
  await assert.rejects(publishArticle({article:article(f.cover),token:'test-token',fetcher:f.fetcher}),/Обложки ещё нет/);
  assert.equal(f.calls.filter(c=>c.method==='POST'||c.method==='PATCH').length,0);
});
test('Deployment excludes unused covers and reports actual output bytes, without touching source',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kefirt-storage-'));
  try{
    const dist=path.join(tmp,'dist'),media=path.join(dist,'media/covers');fs.mkdirSync(media,{recursive:true});
    fs.writeFileSync(path.join(media,'used.webp'),'used');fs.writeFileSync(path.join(media,'unused.webp'),'unused');
    fs.writeFileSync(path.join(tmp,'original.png'),'source');fs.writeFileSync(path.join(dist,'index.html'),'<img src="/media/covers/used.webp">');
    const report=finalizeStorage(dist);assert.equal(report.coverCount,1);assert.equal(report.coverBytes,4);
    assert.equal(fs.existsSync(path.join(media,'unused.webp')),false);assert.equal(fs.readFileSync(path.join(tmp,'original.png'),'utf8'),'source');
    const total=fs.statSync(path.join(dist,'index.html')).size+4+fs.statSync(path.join(dist,'storage.json')).size;assert.equal(report.siteBytes,total);
    assert.deepEqual(finalizeStorage(dist),report);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
