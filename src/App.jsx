import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import readme from '../README.md?raw'

function App() {
  return <ProjectHeader readme={readme} />
}

export default App
