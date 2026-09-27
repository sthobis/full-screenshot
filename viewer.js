const $ = (id) => document.getElementById(id);

(async () => {
  const shot = await chrome.runtime.sendMessage({ type: 'get' });
  if (!shot) return;

  const blob = await (await fetch(shot.image)).blob();
  const url = URL.createObjectURL(blob);

  $('empty').hidden = true;
  $('shot').src = url;
  $('shot').hidden = false;
  $('source').textContent = shot.source;
  $('dims').textContent = `${shot.width} x ${shot.height} - ${Math.round(blob.size / 1024)} KB`;
  document.title = shot.name;

  $('zoom').onclick = (e) => {
    const actual = $('shot').classList.toggle('actual');
    e.target.textContent = actual ? 'Fit width' : 'Actual size';
  };

  $('copy').onclick = async (e) => {
    const label = e.target.textContent;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      e.target.textContent = 'Copied';
    } catch (err) {
      e.target.textContent = 'Copy failed';
    }
    setTimeout(() => (e.target.textContent = label), 1500);
  };

  $('download').onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = shot.name;
    a.click();
  };
})();
