import type { ViewId } from '../../shared/types'
import { Dashboard } from './Dashboard'
import { Projects } from './Projects'
import { Services } from './Services'
import { Notifications } from './Notifications'
import { Settings } from './Settings'
import { Terminal } from './Terminal'
import { Git } from './Git'
import { Snippets } from './Snippets'
import { AIAgent } from './ai'
import { Cloud } from './Cloud'
import { Docker } from './Docker'
import { Database } from './Database'
import { ApiPlayground } from './ApiPlayground'
import { ServiceView } from './ServiceView'
import { useStore } from '../state/store'

export function ViewRouter({
  view, projectId, serviceId, visible = true,
}: { view: ViewId; projectId: string | null; serviceId?: string | null; visible?: boolean }) {
  const service = useStore((s) => s.services.find((x) => x.id === serviceId) ?? null)

  // A Services tab carrying a serviceId hosts that service's embedded view.
  if (view === 'services' && service) {
    return <ServiceView key={service.id} service={service} visible={visible} />
  }

  switch (view) {
    case 'dashboard': return <Dashboard />
    case 'projects': return <Projects projectId={projectId} />
    case 'services': return <Services />
    case 'notifications': return <Notifications />
    case 'settings': return <Settings />
    case 'terminal': return <Terminal projectId={projectId} />
    case 'git': return <Git projectId={projectId} />
    case 'snippets': return <Snippets />
    case 'ai': return <AIAgent projectId={projectId} />
    case 'cloud': return <Cloud projectId={projectId} />
    case 'docker': return <Docker />
    case 'database': return <Database />
    case 'api': return <ApiPlayground projectId={projectId} />
    default: return <Dashboard />
  }
}
