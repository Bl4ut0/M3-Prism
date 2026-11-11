const fs = require('fs');
const content = fs.readFileSync('index.js', 'utf8');
const lines = content.split('\n');

const correctEnd = `app.get(/^(?!\\/api).+/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server running on port \${PORT}\`);
  console.log(\`Unified App available at http://localhost:\${PORT}\`);
});
`;

fs.writeFileSync('index.js', lines.slice(0, 574).join('\n') + '\n' + correctEnd);
