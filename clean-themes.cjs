const fs = require('fs');
const path = require('path');
const dir = 'extensions/theme-defaults/themes';
fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
  const p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(/\s*"scrollbarSlider\.(background|hoverBackground|activeBackground)":\s*"#000000",?/g, '');
  fs.writeFileSync(p, c);
  console.log('Cleaned', f);
});
