import mammoth from 'mammoth/mammoth.browser';
self.onmessage = async ({data}) => {
  try {
    let imageCount = 0;
    const result = await mammoth.convertToHtml({arrayBuffer:data}, {
      externalFileAccess:false,
      styleMap:["u => u", "strike => s"],
      convertImage:mammoth.images.imgElement(async () => {
        imageCount++;
        return {src:'', alt:'[Изображение из Word — добавьте ссылку на изображение]'};
      })
    });
    self.postMessage({html:result.value, messages:result.messages, imageCount});
  } catch { self.postMessage({error:'Не удалось прочитать Word. Проверь, что это файл .docx, и попробуй пересохранить его в Word.'}); }
};
