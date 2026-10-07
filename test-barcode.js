fetch("http://localhost:5000/api/barcode/412515d3-995f-45ab-9a53-14afe23c3fe2")
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
