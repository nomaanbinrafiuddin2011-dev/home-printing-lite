import Link from 'next/link';
import Estimator from '@/components/Estimator';
const services = [['📄','Document printing','PDFs and photos printed clearly on A4.'],['🎓','Assignments','Neat prints ready to submit.'],['📘','School projects & reports',"Colour where you need it, B&W where you don't."],['📋','Forms & applications','Sharp text, correct page order.'],['📚','Bulk printing','Many copies, same settings, one order.'],['↔️','Double-sided layout','Both sides of the sheet. Billing is per printed side.']];
export default function Home() {
  return <>
    <div className="hero"><div className="wrap">
      <p className="tag">Your Ideas, We Print It!</p>
      <h1>Your Documents. <span>Perfect Prints.</span> Delivered.</h1>
      <p className="lead">Fast, reliable and affordable printing from Hyderabad. Choose colour or black &amp; white, set your pages and copies, and see the price before you order.</p>
      <div className="btns"><Link className="btn pink" href="/upload">Upload &amp; Print Now</Link><Link className="btn ghost" href="/scan">Scan Document</Link><a className="btn green" href="https://wa.me/916301834150">WhatsApp us</a></div>
      <p className="hint" style={{ color: '#c7d2f5' }}>Online upload and scanning are being built; those pages say so clearly.</p>
      <div className="prices" id="pricing">
        <div className="price c"><div>Colour printing<small>A4, per printed page</small></div><div><b>₹9</b>/page</div></div>
        <div className="price b"><div>Black &amp; white printing<small>A4, per printed page</small></div><div><b>₹2</b>/page</div></div>
      </div></div></div>
    <section id="services"><div className="wrap"><h2>Our services</h2><p className="sub">Everything from a single form to a stack of project reports.</p>
      <div className="grid">{services.map(([i, t, d]) => <div className="card" key={t}><div className="ic">{i}</div><h3>{t}</h3><p>{d}</p></div>)}</div></div></section>
    <section id="estimator" style={{ paddingTop: 0 }}><div className="wrap"><h2>Price estimator</h2>
      <p className="sub">The instant figure is a preview. Use “Confirm price with server” to get the authoritative amount.</p><Estimator /></div></section>
    <section id="how" style={{ paddingTop: 0 }}><div className="wrap"><h2>How it works</h2><p className="sub">The planned ordering flow.</p>
      <ol className="steps"><li><b>Upload or scan</b><br /><span className="hint">PDF or photo, or scan with your phone.</span></li><li><b>Choose settings</b><br /><span className="hint">Pages, copies, colour, sides.</span></li><li><b>See the price</b><br /><span className="hint">Review, then confirm.</span></li><li><b>We print it</b><br /><span className="hint">Collect or get it delivered, where available.</span></li></ol></div></section>
    <section id="contact" style={{ paddingTop: 0 }}><div className="wrap"><div className="contact">
      <div><h2 style={{ color: '#fff' }}>Call / WhatsApp</h2><a href="tel:+916301834150">6301834150</a></div>
      <div><h2 style={{ color: '#fff' }}>Visit us</h2><address style={{ fontStyle: 'normal', color: '#dbe3ff' }}>17-5-383, Dabeerpura,<br />Bibi Ka Alawa,<br />Hyderabad, Telangana – 500023</address></div></div></div></section>
  </>;
}
