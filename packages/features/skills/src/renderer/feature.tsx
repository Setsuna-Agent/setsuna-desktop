import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { capabilitiesRefreshCoordinatorCapability } from '@setsuna-desktop/renderer-contracts/capabilities';
import {
  CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
  registerSettingsPage,
  registerSettingsPageExtension,
} from '@setsuna-desktop/renderer-contracts/settings';
import { lazy } from 'react';
import {
  skillsFeature,
  skillsRendererServiceCapability,
} from '../contracts/index.js';
import { createSkillsRendererClient } from './client.js';
import { skillsMessages } from './messages.js';
import { RendererSkillsService } from './service.js';

const SkillsCapabilitiesPage = lazy(async () => {
  const module = await import('./SkillsCapabilitiesPage.js');
  return { default: module.SkillsCapabilitiesPage };
});

const SkillsExtraRootsSettings = lazy(async () => {
  const module = await import('./SkillsCapabilitiesPage.js');
  return { default: module.SkillsExtraRootsSettings };
});

const dependencies = defineRendererDependencies({
  capabilitiesRefresh: requiredCapability(capabilitiesRefreshCoordinatorCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(skillsRendererServiceCapability);

export const skillsRendererFeature = defineRendererFeature({
  definition: skillsFeature,
  dependencies,
  provides: [serviceProvider],
  messages: [skillsMessages],
  setup(context) {
    const service = new RendererSkillsService({
      client: createSkillsRendererClient(context.dependencies.transport),
      scope: context.scope,
    });
    context.provide(serviceProvider, service);
    context.scope.add(context.dependencies.capabilitiesRefresh.register('skills', () => service.refresh()));
    registerSettingsPage(context.ui, {
      entryId: 'skills.capabilities-page',
      location: 'capabilities',
      navigationGroupId: CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
      order: 200,
      pageHeading: 'view',
      sectionId: 'skills',
      titleKey: 'feature.skills.title',
      render: (props) => (
        <SkillsCapabilitiesPage
          {...props}
          capabilitiesRefresh={context.dependencies.capabilitiesRefresh}
          service={service}
        />
      ),
    });
    registerSettingsPageExtension(context.ui, {
      entryId: 'skills.runtime-extra-roots',
      id: 'skills-extra-roots',
      order: 300,
      targetSectionId: 'runtime',
      render: ({ translate, ui }) => (
        <SkillsExtraRootsSettings service={service} translate={translate} ui={ui} />
      ),
    });
  },
});
