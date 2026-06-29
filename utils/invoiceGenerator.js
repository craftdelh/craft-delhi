const PDFDocument = require('pdfkit');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Helper to fetch image as Buffer
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      return reject(new Error('No URL provided'));
    }
    
    // Set a timeout of 5 seconds
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to get image: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => reject(err));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Image fetch timeout'));
    });

    req.on('error', (err) => reject(err));
  });
}

exports.generateInvoicePDF = async (order, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

  const fileName = `invoice-${order.order_uid}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"`
  );

  doc.pipe(res);

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  // Pre-fetch all item images asynchronously
  const itemsWithImages = await Promise.all(
    order.items.map(async (item) => {
      if (item.main_image_url && (item.main_image_url.startsWith('http://') || item.main_image_url.startsWith('https://'))) {
        try {
          const buffer = await fetchImageBuffer(item.main_image_url);
          return { ...item, imageBuffer: buffer };
        } catch (e) {
          console.error(`Error fetching image for product ${item.product_name}:`, e.message);
          return { ...item, imageBuffer: null };
        }
      }
      return { ...item, imageBuffer: null };
    })
  );

  // 1. Header (Logo & Title)
  const logoPath = path.join(__dirname, '../assets/craftdelhi_logo.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 40, 45, { height: 40 });
  } else {
    doc.fontSize(22).fillColor('#2c3e50').text('Craft Delhi', 40, 45, { bold: true });
  }

  // Invoice Title
  doc
    .fillColor('#2c3e50')
    .fontSize(26)
    .text('INVOICE', pageWidth - 200, 40, { align: 'right', width: 160 });

  // Invoice Details (Top Right)
  doc
    .fillColor('#2d3436')
    .fontSize(9)
    .text(`Invoice No: ${order.order_uid}`, pageWidth - 220, 75, { align: 'right', width: 180 })
    .text(`Invoice Date: ${new Date(order.created_at).toLocaleDateString()}`, { align: 'right', width: 180 })
    .text(`Payment Method: ${order.payment_method || 'N/A'}`, { align: 'right', width: 180 })
    .text(`Payment Status: ${order.payment_status || 'N/A'}`, { align: 'right', width: 180 });

  doc.moveDown(1.5);

  // 2. Seller and Buyer Section (Two Column Layout)
  const infoY = Math.max(doc.y, 140);
  
  // Left Column - Seller Store Details
  doc
    .fontSize(11)
    .fillColor('#2c3e50')
    .text('SOLD BY (SELLER)', 40, infoY, { underline: true })
    .moveDown(0.3);

  const sellerAddress = [
    order.seller_office_address,
    order.seller_home_address,
    order.seller_city
  ].filter(Boolean).join(', ') || 'India';

  doc
    .fontSize(9)
    .fillColor('#2d3436')
    .text(order.seller_store_name || 'Craft Delhi Store', { width: 240 })
    .text(sellerAddress, { width: 240 })
    .text(`Email: ${order.seller_email || 'info@craftdelhi.com'}`, { width: 240 });
  if (order.seller_phone_number) {
    doc.text(`Phone: ${order.seller_phone_number}`, { width: 240 });
  }
  if (order.seller_business_number) {
    doc.text(`GSTIN/Business No: ${order.seller_business_number}`, { width: 240 });
  }

  // Right Column - Bill To (Buyer Details)
  doc
    .fontSize(11)
    .fillColor('#2c3e50')
    .text('BILL TO (BUYER)', pageWidth / 2 + 10, infoY, { underline: true })
    .moveDown(0.3);

  doc
    .fontSize(9)
    .fillColor('#2d3436')
    .text(order.buyer_name || 'Customer Name', pageWidth / 2 + 10, doc.y, { width: 240 })
    .text(order.shipping_info || 'Shipping address not available', { width: 240 })
    .text(`Email: ${order.email || 'N/A'}`, { width: 240 })
    .text(`Phone: ${order.phone_number || 'N/A'}`, { width: 240 });

  doc.moveDown(2);

  // 3. Items Table
  const tableHeaderTop = doc.y;
  
  const drawTableHeader = (yPos) => {
    doc.rect(40, yPos, pageWidth - 80, 20).fill('#f1f2f6');
    doc
      .fillColor('#2c3e50')
      .fontSize(9)
      .text('Image', 45, yPos + 6, { width: 50 })
      .text('Product Details', 105, yPos + 6, { width: 230 })
      .text('Price', 345, yPos + 6, { width: 65, align: 'right' })
      .text('Qty', 420, yPos + 6, { width: 35, align: 'center' })
      .text('Total', 465, yPos + 6, { width: 85, align: 'right' });
  };

  drawTableHeader(tableHeaderTop);
  
  let currentY = tableHeaderTop + 25;

  itemsWithImages.forEach((item, index) => {
    const itemTotal = item.quantity * item.price;
    const textHeight = doc.heightOfString(item.product_name, { width: 230 });
    const rowHeight = Math.max(50, textHeight + 15);

    // Check for page break
    if (currentY + rowHeight > pageHeight - 80) {
      doc.addPage();
      currentY = 50; // top margin on new page
      drawTableHeader(currentY);
      currentY += 25;
    }

    // Draw background for alternating rows (optional but premium)
    if (index % 2 === 1) {
      doc.rect(40, currentY - 2, pageWidth - 80, rowHeight).fill('#fafafa');
    }

    // Draw Image
    if (item.imageBuffer) {
      try {
        doc.image(item.imageBuffer, 45, currentY + 3, { fit: [40, 40] });
      } catch (imgError) {
        console.error('Error drawing item image in PDF:', imgError.message);
        // Draw fallback square
        doc.rect(45, currentY + 3, 40, 40).fillAndStroke('#f1f2f6', '#dcdde1');
      }
    } else {
      // Draw a neat placeholder box
      doc.save();
      doc.rect(45, currentY + 3, 40, 40).fillAndStroke('#f5f6fa', '#dcdde1');
      doc.fillColor('#7f8c8d').fontSize(7).text('No Image', 47, currentY + 19, { width: 36, align: 'center' });
      doc.restore();
    }

    // Draw Text Details
    doc
      .fillColor('#2d3436')
      .fontSize(9)
      .text(item.product_name, 105, currentY + 5, { width: 230 })
      .text(`Rs. ${parseFloat(item.price).toFixed(2)}`, 345, currentY + 5, { width: 65, align: 'right' })
      .text(item.quantity.toString(), 420, currentY + 5, { width: 35, align: 'center' })
      .text(`Rs. ${itemTotal.toFixed(2)}`, 465, currentY + 5, { width: 85, align: 'right' });

    // Draw row separator line
    doc
      .moveTo(40, currentY + rowHeight - 2)
      .lineTo(pageWidth - 40, currentY + rowHeight - 2)
      .lineWidth(0.5)
      .stroke('#f1f2f6');

    currentY += rowHeight;
  });

  // 4. Payment Info and Total Summary (drawn side-by-side)
  const summaryHeight = 90;
  if (currentY + summaryHeight > pageHeight - 80) {
    doc.addPage();
    currentY = 50;
  }

  const summaryTop = currentY + 15;

  // Left side - Payment Details
  doc
    .fontSize(10)
    .fillColor('#2c3e50')
    .text('PAYMENT INFORMATION', 40, summaryTop, { underline: true })
    .moveDown(0.3);

  doc
    .fontSize(9)
    .fillColor('#2d3436')
    .text(`Method: ${order.payment_method || 'N/A'}`)
    .text(`Transaction ID: ${order.payment_uid || 'N/A'}`)
    .text(`Status: ${order.payment_status || 'N/A'}`);

  // Tracking Info (if exists)
  if (order.tracking_info && order.tracking_details) {
    doc.moveDown(0.8);
    doc
      .fontSize(10)
      .fillColor('#2c3e50')
      .text('SHIPPING / TRACKING', 40, doc.y, { underline: true })
      .moveDown(0.3);

    const tracking = order.tracking_details;
    doc
      .fontSize(9)
      .fillColor('#2d3436')
      .text(`Partner: ${tracking.tracking_company || 'N/A'}`)
      .text(`Tracking No: ${tracking.tracking_number || 'N/A'}`)
      .text(`Status: ${tracking.tracking_status || 'N/A'}`);
  }

  // Right side - Total Summary Box
  const summaryBoxX = pageWidth - 240;
  doc
    .rect(summaryBoxX, summaryTop, 200, 70)
    .fill('#f8f9fa')
    .stroke('#dcdde1');

  doc
    .fillColor('#2c3e50')
    .fontSize(10)
    .text('Total Amount', summaryBoxX + 15, summaryTop + 15)
    .fontSize(14)
    .fillColor('#27ae60')
    .text(`Rs. ${parseFloat(order.total_amount).toFixed(2)}`, {
      align: 'right',
      width: 170
    });

  // 5. Draw Borders, Header lines, and Footer text on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    
    // Page border
    doc
      .rect(20, 20, pageWidth - 40, pageHeight - 40)
      .lineWidth(1)
      .stroke('#dcdde1');

    // Bottom Footer
    doc
      .fontSize(8)
      .fillColor('#7f8c8d')
      .text(
        'Thank you for shopping with us! | This is a computer-generated invoice and does not require a physical signature.',
        40,
        pageHeight - 35,
        { align: 'center', width: pageWidth - 80 }
      );

    // Page Number
    doc
      .fontSize(8)
      .fillColor('#7f8c8d')
      .text(`Page ${i + 1} of ${range.count}`, pageWidth - 100, pageHeight - 35, { align: 'right', width: 60 });
  }

  doc.end();
};
