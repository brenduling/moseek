function GreetingNode({ data }) {
  return (
    <div className="spatial-greeting">
      <h1>Welcome back{data.name ? `, ${data.name}` : ''}.</h1>
      <p>{data.hasEnvironments ? 'Your Environments are ready when you are.' : 'A good place to begin.'}</p>
    </div>
  )
}

export default GreetingNode
