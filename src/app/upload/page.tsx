import UploadFlow from '@/components/UploadFlow';
export const metadata = { title: 'Upload & Print' };
export default function P() {
  return <div className="wrap page"><h1>Upload &amp; Print</h1>
    <p>Upload a PDF, choose your pages and print options, and place a cash-on-pickup or cash-on-delivery order. Online payment is not available yet.</p>
    <UploadFlow /></div>;
}
