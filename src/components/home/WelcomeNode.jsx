function WelcomeNode({ data }) {
  return <section className="home-welcome nodrag nopan" aria-label="Welcome to Moseek">
    <h2>A space for everything you're working on.</h2>
    <p>Bring your notes, links, and ideas together. Arrange them in a way that makes sense to you.</p>
    <div className="home-welcome-actions">
      <button type="button" className="home-welcome-primary" onClick={data.onCreate}>Create your first Environment</button>
      <button type="button" className="home-welcome-secondary" onClick={data.onExplore}>Explore Moseek</button>
    </div>
  </section>
}

export default WelcomeNode
