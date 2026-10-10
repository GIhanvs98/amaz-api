import * as fs from 'fs';
import * as path from 'path';

function formatDoctors() {
  const file = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Amaz Data/doctors.md';
  const content = fs.readFileSync(file, 'utf-8').trim();
  const lines = content.split('\n').filter(l => l.trim() !== '');
  
  let markdown = '';
  const headers = lines[0].split('\t').map(x => x.trim());
  markdown += `| ${headers.join(' | ')} |\n`;
  markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;
  
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t').map(x => x.trim());
    if (row.length === headers.length) {
      markdown += `| ${row.join(' | ')} |\n`;
    }
  }
  
  fs.writeFileSync(file, markdown);
  console.log('Formatted doctors.md');
}

function formatInventory() {
  const file = '/Volumes/240GB SSD/Projects/AMAZ-Hospital/Amaz Data/Inventory.md';
  const content = fs.readFileSync(file, 'utf-8').trim();
  const lines = content.split('\n').filter(l => l.trim() !== '');
  
  let markdown = '';
  const headers = lines[0].split('\t').map(x => x.trim());
  // Ensure "Price" header is present and clean
  if (headers[headers.length-1].toLowerCase().includes('price')) {
    headers[headers.length-1] = 'Price (LKR)';
  }
  markdown += `| ${headers.join(' | ')} |\n`;
  markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;
  
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t').map(x => x.trim());
    
    // Assign price based on category and name
    const category = row[0].toLowerCase();
    const name = row[1].toLowerCase();
    const strength = row[2] ? row[2].toLowerCase() : '';
    let price = 50; // Default
    
    if (category === 'cream' || category === 'topical') price = 350;
    else if (category === 'gel') price = 450;
    else if (category === 'syrup') price = 600;
    else if (category === 'eye drop') price = 750;
    else if (category === 'nasal drop') price = 550;
    else if (category === 'strip') price = 250;
    else if (category === 'tablet') {
      if (name.includes('paracetamol') || name.includes('pcm') || name.includes('aspirin') || name.includes('folic')) {
        price = 4;
      } else if (strength.includes('500mg') || name.includes('augmentin') || name.includes('cef')) {
        price = 85;
      } else {
        price = 25;
      }
    }
    
    // Check if the last column is empty or missing
    if (row.length >= 5) {
      row[4] = price.toString();
    } else {
      row.push(price.toString());
    }
    
    // Sometimes row has missing empty strength column
    if (row.length < 5) {
        // Pad to 5 columns
        while(row.length < 4) row.push('');
        row.push(price.toString());
    }

    markdown += `| ${row.slice(0, 5).join(' | ')} |\n`;
  }
  
  fs.writeFileSync(file, markdown);
  console.log('Formatted Inventory.md');
}

formatDoctors();
formatInventory();
