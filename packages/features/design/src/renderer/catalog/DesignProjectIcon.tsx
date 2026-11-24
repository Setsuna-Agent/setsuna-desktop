import { FolderClosed } from 'lucide-react';
import { useContext } from 'react';
import { DesignUiHostContext, type DesignProjectIconProps } from '../context/design-ui-host.js';

export function DesignProjectIcon({ icon, size = 14 }: DesignProjectIconProps) {
  const ProjectIcon = useContext(DesignUiHostContext)?.ProjectIcon;
  return ProjectIcon ? <ProjectIcon icon={icon} size={size} /> : <FolderClosed size={size} aria-hidden="true" />;
}
