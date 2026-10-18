export const MAX_COVER_BYTES = 200 * 1024;
export const TARGET_COVER_BYTES = 120 * 1024;
export const COVER_PATH = /^\/media\/covers\/[a-f0-9]{64}\.webp$/;

export function validateCover(cover) {
  if (!cover) return;
  if (!COVER_PATH.test(cover.src || '')) throw new Error('Некорректная обложка. Загрузи картинку через блок «Обложка».');
  if (!Number.isInteger(cover.width) || cover.width < 1 || cover.width > 1800 || !Number.isInteger(cover.height) || cover.height < 1 || cover.height > 1200) throw new Error('Обложка превышает допустимые размеры. Загрузи её заново.');
  if (!Number.isInteger(cover.bytes) || cover.bytes < 1 || cover.bytes > MAX_COVER_BYTES) throw new Error('Обложка должна занимать не больше 200 КБ.');
  for (const field of ['alt','caption']) if (cover[field] != null && typeof cover[field] !== 'string') throw new Error('Некорректное описание обложки.');
}
export function coverDimensions(width, height, maxWidth = 1800) {
  const scale = Math.min(1, maxWidth / width, 1200 / height);
  return {width:Math.max(1,Math.round(width*scale)), height:Math.max(1,Math.round(height*scale))};
}
export function bytesToBase64(bytes) {
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
export function base64ToBytes(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_COVER_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Повреждён файл обложки в черновике.');
  let bytes;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}catch{throw new Error('Повреждён файл обложки в черновике.');}
  if (bytes.length > MAX_COVER_BYTES || String.fromCharCode(...bytes.slice(0,4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8,12)) !== 'WEBP') throw new Error('В черновике должна быть сжатая обложка WebP до 200 КБ.');
  return bytes;
}
export async function digestHex(algorithm, bytes) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest(algorithm,bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function validateCoverAsset(cover, asset) {
  validateCover(cover);
  if (!cover || asset?.src !== cover.src) throw new Error('Файл обложки не соответствует статье. Загрузи обложку заново.');
  const bytes=base64ToBytes(asset.base64);
  if (bytes.length !== cover.bytes || `/media/covers/${await digestHex('SHA-256',bytes)}.webp` !== cover.src) throw new Error('Файл обложки повреждён. Загрузи его заново.');
  return bytes;
}
export const coverDataUrl = asset => `data:image/webp;base64,${asset.base64}`;

// Injectable encoder makes the size budget testable without a browser canvas.
export async function fitCover(width, height, encode) {
  let best = null;
  const sizes = [...new Set([1800,1440,1152,960].map(max=>JSON.stringify(coverDimensions(width,height,max))))].map(JSON.parse);
  for (const size of sizes) {
    for (const quality of [.84,.76,.68,.60]) {
      const blob=await encode(size,quality);
      if (!blob || blob.type !== 'image/webp') throw new Error('Этот браузер не поддерживает сохранение WebP. Открой редактор в актуальном Chrome, Edge или Firefox.');
      if (blob.size <= MAX_COVER_BYTES && !best) best={blob,...size};
      if (blob.size <= TARGET_COVER_BYTES) return {blob,...size};
    }
  }
  if (best) return best;
  throw new Error('Не удалось сжать обложку до 200 КБ. Упрости изображение или экспортируй его меньшего размера.');
}
export async function prepareCover(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Выбери PNG, JPEG или WebP. Из Inkscape экспортируй PNG.');
  if (file.size > 20*1024*1024) throw new Error('Исходная картинка больше 20 МБ. Экспортируй из Inkscape PNG размером 1800 × 600 пикселей.');
  let image;
  try { image=await createImageBitmap(file); } catch { throw new Error('Не удалось прочитать изображение. Попробуй экспортировать его в PNG заново.'); }
  try {
    if (image.width * image.height > 40_000_000) throw new Error('Слишком большое разрешение. Экспортируй обложку размером 1800 × 600 пикселей.');
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    if (!context) throw new Error('Не удалось запустить обработку изображения.');
    let currentSize='';
    const result=await fitCover(image.width,image.height,async(size,quality)=>{
      const key=`${size.width}:${size.height}`;
      if(currentSize!==key){canvas.width=size.width;canvas.height=size.height;context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,size.width,size.height);currentSize=key;}
      return new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));
    });
    const bytes=new Uint8Array(await result.blob.arrayBuffer());
    const src=`/media/covers/${await digestHex('SHA-256',bytes)}.webp`;
    return {cover:{src,width:result.width,height:result.height,bytes:bytes.length,alt:'',caption:''},asset:{src,base64:bytesToBase64(bytes)},originalBytes:file.size};
  } finally { image.close(); }
}
