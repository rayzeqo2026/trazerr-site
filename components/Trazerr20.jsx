import React from "react";
import "./trazerr.css";

/*
 Trazerr 2.0 visual direction:
 - warm editorial paper background
 - navy typography
 - blue evidence signals
 - restrained red for "worth exploring"
 - evidence-first cards, not generic SaaS dashboards
 - mobile-first responsive layout
*/

export default function Trazerr20() {
  const evidence = [
    ["01","Territory development","On resume · Opened and grew a new territory"],
    ["02","Quota performance","On resume · Reached 118% of annual quota"],
    ["03","Training & onboarding","On resume · Trained new sales hires"],
    ["04","Early team leadership","Between the lines · Evidence suggests leadership"],
    ["05","Negotiation","Between the lines · Repeated enterprise deal exposure"],
  ];

  return (
    <div className="tz">
      <header className="tz-nav">
        <div className="tz-brand"><span className="tz-logo"/>Trazerr</div>
        <nav>
          <a className="active">Career DNA</a><a>Tailor my DNA</a><a>Trazerr Match</a>
          <a>For employers</a><a>About</a>
        </nav>
        <div className="tz-actions"><button className="round">◯</button><button className="round">☾</button><button className="tz-primary">Try it free</button></div>
      </header>

      <section className="tz-hero">
        <div className="tz-container tz-hero-grid">
          <div>
            <div className="tz-kicker">Career intelligence, built from evidence</div>
            <h1>What could your career <i>become?</i></h1>
            <p className="tz-lead">Upload your resume. Trazerr turns what you've actually done into your Career DNA, then connects it to jobs, career paths, and opportunities that fit.</p>
            <button className="tz-primary">Build my Career DNA →</button>
          </div>
          <div className="upload">
            <h3>See your Career DNA</h3>
            <p>Start with your resume. Trazerr reads the evidence before it makes a recommendation.</p>
            <textarea placeholder="Paste your resume here..."/>
            <div className="drop">↑ &nbsp; Or upload a file (PDF, Word)</div>
            <button className="tz-primary full">Build my Career DNA</button>
          </div>
        </div>
      </section>

      <section className="tz-section">
        <div className="tz-container">
          <div className="tz-two-col">
            <div><div className="tz-kicker">How Trazerr reads a resume</div><h2>From resume to <i>Career DNA</i> in three steps.</h2></div>
            <p>Each piece of evidence becomes a signal. Trazerr separates what your resume proves, what it suggests, and what is worth exploring next.</p>
          </div>
          <div className="pills"><span>1 · Your Resume</span><span>2 · The Highlights</span><span className="selected">3 · Your Career DNA</span></div>
          <div className="dna-area">
            <div className="dna-helix"/>
            <div className="evidence-list">{evidence.map(([n,t,d]) => <div className="evidence" key={n}><b>{n}</b><div><strong>{t}</strong><small>{d}</small></div></div>)}</div>
          </div>
          <div className="career-paths"><div><b>Senior Sales Rep</b><small>WHERE YOU ARE</small></div><div><b>Sales Team Lead</b><small>WORTH EXPLORING</small></div><div><b>Sales Enablement</b><small>WORTH EXPLORING</small></div></div>
        </div>
      </section>

      <section className="tz-section white"><div className="tz-container tz-two-col">
        <div><div className="tz-kicker">What you get</div><h2>Real strengths, not a pep talk.</h2><p className="tz-lead">Your Career DNA puts every strength next to the line in your resume that shows it, and points to roles your record already supports.</p><button className="tz-primary">Build my Career DNA</button></div>
        <div className="dna-profile"><div className="score">78</div><div className="tz-kicker">Example · Career DNA</div><h3>Dana Whitfield</h3><p>7 years in B2B sales · Newark, NJ</p><p>A sales representative whose record reads closer to a sales leader than the title suggests.</p><div className="result">Worth exploring · <b>Sales team lead</b><br/><small>Next step: show a result from a team you guided.</small></div></div>
      </div></section>

      <section className="tz-section pale"><div className="tz-container"><div className="tz-kicker">03 · For employers</div><h2>Job DNA creates matches you can explain.</h2><div className="employer-grid"><div className="panel"><span className="score">82</span><h3>Example candidate fit</h3><p>Regional Sales Manager</p><hr/><b>Experience</b><p>6 years in role scope, territory and account ownership</p><div className="meter"><span style={{width:"82%"}}/></div><br/><b>Skills</b><p>Negotiation and CRM use, backed by resume evidence</p><div className="meter"><span style={{width:"90%"}}/></div></div><div className="panel"><h3>Try Job DNA</h3><textarea placeholder="Paste the full job posting here..."/><div className="drop">↑ &nbsp; Or upload the posting (PDF, Word)</div><button className="tz-primary">Build Job DNA</button></div></div></div></section>

      <section className="tz-cta"><div className="tz-container"><div><div className="tz-kicker">Start with what you've already done</div><h2>Your resume says more than you think.<br/>Find out what.</h2></div><button className="white-btn">Upload my resume →</button></div></section>
    </div>
  );
}