
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import morgan from 'morgan';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // for PayFast ITN (x-www-form-urlencoded)
app.use(morgan('tiny'));
app.disable('x-powered-by');

const INVOICE_DIR = path.resolve('invoices');
if (!fs.existsSync(INVOICE_DIR)) fs.mkdirSync(INVOICE_DIR);
app.use('/invoices', express.static(INVOICE_DIR));

// ---- Config ----
const CFG = {
  PORT: process.env.PORT || 8787,
  ENV: process.env.ENV || 'live', // sandbox|live
  MERCHANT_ID: process.env.MERCHANT_ID,
  MERCHANT_KEY: process.env.MERCHANT_KEY,
  PASSPHRASE: process.env.PASSPHRASE || '',
  RETURN_URL: process.env.RETURN_URL || 'https://wykiesautomation.co.za/thanks',
  CANCEL_URL: process.env.CANCEL_URL || 'https://wykiesautomation.co.za/cancelled',
  NOTIFY_URL: process.env.NOTIFY_URL || 'https://wykiesautomation.co.za/payfast/itn',
  ALLOW_ORIGIN: process.env.ALLOW_ORIGIN || '*',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'wykiesautomation@gmail.com',
  FROM_EMAIL: process.env.FROM_EMAIL || 'wykiesautomation@gmail.com',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_SECURE: (process.env.SMTP_SECURE || 'true') === 'true',
  SMTP_USER: process.env.SMTP_USER || 'wykiesautomation@gmail.com',
  SMTP_PASS: process.env.SMTP_PASS || '',
  COMPANY_NAME: process.env.COMPANY_NAME || 'Wykies Automation',
  COMPANY_ADDR: process.env.COMPANY_ADDR || 'South Africa',
  COMPANY_TEL: process.env.COMPANY_TEL || '+27 71 681 6131',
  COMPANY_EMAIL: process.env.COMPANY_EMAIL || 'wykiesautomation@gmail.com',
  COMPANY_VAT_NOTE: process.env.COMPANY_VAT_NOTE || 'All prices VAT-inclusive.'
};

// Create mail transporter
const mailer = nodemailer.createTransport({
  host: CFG.SMTP_HOST,
  port: CFG.SMTP_PORT,
  secure: CFG.SMTP_SECURE,
  auth: { user: CFG.SMTP_USER, pass: CFG.SMTP_PASS }
});

const PRICE_LOG = { 'WA-01':1499.00,'WA-02':2499.00,'WA-03':6499.00,'WA-04':899.00,'WA-05':800.00,'WA-06':3999.00,'WA-07':1800.00,'WA-08':999.00,'WA-09':1009.00,'WA-10':1299.00,'WA-11':5499.00 };

const PROCESS_URL = CFG.ENV === 'sandbox' ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process';
app.use(cors({ origin: CFG.ALLOW_ORIGIN, credentials: false }));

function urlencode(val){return encodeURIComponent(String(val)).replace(/%20/g,'+').replace(/%([0-9a-fA-F]{2})/g,(m,h)=>'%'+h.toUpperCase());}
function signParams(params, passphrase){
  const pairs = Object.keys(params).filter(k=>params[k]!==undefined&&params[k]!==null&&params[k]!==''&&k!=='signature').sort().map(k=>`${k}=${urlencode(params[k])}`);
  if (passphrase) pairs.push(`passphrase=${urlencode(passphrase)}`);
  return crypto.createHash('md5').update(pairs.join('&')).digest('hex');
}

function pad(n, w=4){return String(n).padStart(w,'0');}
function invoiceNumberFor(pf_payment_id){
  const d=new Date();
  const y=d.getFullYear(); const m=pad(d.getMonth()+1,2);
  const last6 = (pf_payment_id||'000000').toString().slice(-6);
  return `INV-${y}${m}-${last6}`;
}

function createInvoicePDFBuffer(data){
  return new Promise((resolve,reject)=>{
    const doc = new PDFDocument({ size:'A4', margin:50 });
    const chunks=[];
    doc.on('data', c=>chunks.push(c));
    doc.on('end', ()=>resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fillColor('#111').fontSize(20).text(CFG.COMPANY_NAME, {continued:false});
    doc.moveDown(0.3).fontSize(10).fillColor('#444').text(CFG.COMPANY_ADDR);
    doc.text(`Tel: ${CFG.COMPANY_TEL}`);
    doc.text(`Email: ${CFG.COMPANY_EMAIL}`);

    doc.moveDown(1);
    doc.rect(doc.x, doc.y, 500, 1).fill('#2F76FF').fillColor('#111');
    doc.moveDown(0.8);

    // Invoice meta
    doc.fontSize(16).fillColor('#111').text('TAX INVOICE');
    doc.moveDown(0.3).fontSize(10).fillColor('#444')
      .text(`Invoice No: ${data.invoiceNo}`)
      .text(`Date: ${data.date}`)
      .text(`PayFast ID: ${data.pf_payment_id || ''}`)
      .text(`Order ID: ${data.m_payment_id || ''}`);

    // Bill To
    doc.moveDown(0.8).fontSize(12).fillColor('#111').text('Bill To');
    doc.fontSize(10).fillColor('#444')
      .text(`${data.customer_name || ''}`)
      .text(`${data.customer_email || ''}`)
      .text(`${data.customer_phone || ''}`);

    // Items table
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#111');
    const startX = doc.x; const startY = doc.y;
    const col = (x)=> startX + x;
    const rowH = 18;

    function row(y, cells){
      doc.fontSize(10).fillColor('#111');
      doc.text(cells[0], col(0), y, { width: 200 });
      doc.text(cells[1], col(210), y, { width: 100 });
      doc.text(cells[2], col(320), y, { width: 60, align:'right' });
      doc.text(cells[3], col(390), y, { width: 60, align:'right' });
      doc.text(cells[4], col(460), y, { width: 80, align:'right' });
    }

    // Header row
    doc.fontSize(10).fillColor('#2F76FF');
    row(startY, ['Description','SKU','Qty','Unit','Total']);
    doc.rect(startX, startY+14, 540, 1).fill('#e0e7ff');

    // Single item
    const y2 = startY + rowH;
    doc.fillColor('#111');
    row(y2, [data.item_description || data.item_name, data.sku, '1', `R ${Number(data.amount).toFixed(2)}`, `R ${Number(data.amount).toFixed(2)}`]);

    // Totals
    const y3 = y2 + rowH*2;
    doc.fontSize(10).fillColor('#444').text(CFG.COMPANY_VAT_NOTE, startX, y3);
    doc.fontSize(12).fillColor('#111').text('Total Due:', col(390), y3, { width: 60, align:'right' });
    doc.text(`R ${Number(data.amount).toFixed(2)}`, col(460), y3, { width:80, align:'right' });

    // Footer
    doc.moveDown(4);
    doc.fontSize(9).fillColor('#777').text('Thank you for your purchase!', { align:'center' });

    doc.end();
  });
}

async function emailInvoice(pdfBuffer, data){
  const to = [data.customer_email].filter(Boolean).join(',');
  const cc = CFG.ADMIN_EMAIL;
  const subject = `${CFG.COMPANY_NAME} Invoice ${data.invoiceNo}`;
  const text = `Hi ${data.customer_name||''},

Please find your invoice attached.

Invoice: ${data.invoiceNo}
SKU: ${data.sku}
Amount: R ${Number(data.amount).toFixed(2)}
PayFast ID: ${data.pf_payment_id||''}

Regards,
${CFG.COMPANY_NAME}`;
  const info = await mailer.sendMail({ from: CFG.FROM_EMAIL, to, cc, subject, text, attachments:[{ filename: `${data.invoiceNo}.pdf`, content: pdfBuffer }] });
  return info.messageId || true;
}

function saveInvoiceFiles(buffer, data){
  const pdfPath = path.join(INVOICE_DIR, `${data.invoiceNo}.pdf`);
  const jsonPath = path.join(INVOICE_DIR, `${data.invoiceNo}.json`);
  fs.writeFileSync(pdfPath, buffer);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  return { pdfPath, jsonPath, fileUrl: `/invoices/${data.invoiceNo}.pdf` };
}

// ---- Sign endpoint ----
app.post('/payfast/sign', (req,res)=>{
  try{
    const { sku, name_first='', name_last='', email_address='', m_payment_id='' } = req.body || {};
    if (!sku || !PRICE_LOG[sku]) return res.status(400).json({ ok:false, error:'Unknown SKU' });
    const amount = PRICE_LOG[sku].toFixed(2);
    const payload = {
      merchant_id: CFG.MERCHANT_ID,
      merchant_key: CFG.MERCHANT_KEY,
      return_url: CFG.RETURN_URL,
      cancel_url: CFG.CANCEL_URL,
      notify_url: CFG.NOTIFY_URL,
      name_first, name_last, email_address,
      m_payment_id,
      amount,
      item_name: sku,
      item_description: `${sku} purchase`,
      custom_str1: sku
    };
    const signature = signParams(payload, CFG.PASSPHRASE);
    res.json({ ok:true, processUrl: PROCESS_URL, fields:{ ...payload, signature } });
  }catch(err){ console.error(err); res.status(500).json({ ok:false, error:'Internal error' }); }
});

// ---- ITN ----
app.post('/payfast/itn', async (req, res) => {
  try {
    res.status(200).send('OK'); // respond immediately
    const incoming = req.body || {};
    const sigValid = incoming.signature === signParams(incoming, CFG.PASSPHRASE);
    const sku = incoming.custom_str1;
    const expected = PRICE_LOG[sku];
    const amount = parseFloat(incoming.amount_gross || incoming.amount || '0');
    const amountOk = expected && Math.abs(amount - expected) < 0.01;
    const status = incoming.payment_status; // COMPLETE

    if (sigValid && amountOk && status === 'COMPLETE') {
      const invoiceNo = invoiceNumberFor(incoming.pf_payment_id);
      const data = {
        invoiceNo,
        date: new Date().toLocaleString('en-ZA'),
        pf_payment_id: incoming.pf_payment_id,
        m_payment_id: incoming.m_payment_id,
        sku,
        item_name: incoming.item_name || sku,
        item_description: incoming.item_description || `${sku} purchase`,
        amount: expected,
        customer_name: `${incoming.name_first||''} ${incoming.name_last||''}`.trim(),
        customer_email: incoming.email_address || '',
        customer_phone: incoming.cell_number || ''
      };
      const pdf = await createInvoicePDFBuffer(data);
      const saved = saveInvoiceFiles(pdf, data);
      try{ await emailInvoice(pdf, data); }catch(e){ console.error('email failed', e); }
      console.log('Invoice generated:', saved.fileUrl);
    } else {
      console.warn('ITN validation failed', { sigValid, amountOk, status });
    }

    // Optional: POST back to PayFast validate endpoint
    const validateUrl = CFG.ENV === 'sandbox' ? 'https://sandbox.payfast.co.za/eng/validate' : 'https://www.payfast.co.za/eng/validate';
    try{
      const params = new URLSearchParams();
      Object.keys(incoming).forEach(k=>{ if(incoming[k]!==undefined && incoming[k]!==null) params.append(k, incoming[k]); });
      await fetch(validateUrl, { method:'POST', body: params, headers:{ 'Content-Type':'application/x-www-form-urlencoded' } });
    }catch(e){ console.warn('validate postback failed', e.message); }
  } catch (err) {
    console.error('ITN error', err);
  }
});

// ---- Invoice utilities ----
app.get('/invoices/resend', async (req,res)=>{
  try{
    const invoiceNo = req.query.invoiceNo;
    const jsonPath = path.join(INVOICE_DIR, `${invoiceNo}.json`);
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ ok:false, error:'Not found' });
    const data = JSON.parse(fs.readFileSync(jsonPath,'utf-8'));
    const pdf = fs.readFileSync(path.join(INVOICE_DIR, `${invoiceNo}.pdf`));
    await emailInvoice(pdf, data);
    res.json({ ok:true });
  }catch(err){ console.error(err); res.status(500).json({ ok:false, error:'Resend failed' }); }
});

app.get('/invoices/repair', async (req,res)=>{
  try{
    const invoiceNo = req.query.invoiceNo;
    const jsonPath = path.join(INVOICE_DIR, `${invoiceNo}.json`);
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ ok:false, error:'Not found' });
    const data = JSON.parse(fs.readFileSync(jsonPath,'utf-8'));
    const pdf = await createInvoicePDFBuffer(data);
    const saved = saveInvoiceFiles(pdf, data);
    res.json({ ok:true, fileUrl: saved.fileUrl });
  }catch(err){ console.error(err); res.status(500).json({ ok:false, error:'Repair failed' }); }
});

app.get('/health', (req,res)=> res.json({ ok:true }));

app.listen(CFG.PORT, ()=> console.log(`payfast-proxy listening on :${CFG.PORT} (${CFG.ENV})`));
