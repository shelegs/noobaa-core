import template from './main-layout.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { registerForAlerts } from 'actions';
import * as routes from 'routes';

const navItems = deepFreeze([
    /*{
        name: 'name',
        route: routes.<route>, (see routes.js)
        icon: 'icon',
        label: 'label', (display name, optional)
        beta: true/false, (show beta label)
        preview: true/false (hide when browser not in preview mode)
    },*/
    {
        name: 'overview',
        route: routes.system,
        icon: 'overview',
        label: 'Overview'
    },
    {
        name: 'resources',
        route: routes.pools,
        icon: 'resources',
        label: 'Resources'
    },
    {
        name: 'buckets',
        route: routes.buckets,
        icon: 'buckets',
        label: 'Buckets'
    },
    {
        name: 'funcs',
        route: routes.funcs,
        icon: 'functions',
        label: 'Functions',
        beta: true
    },
    {
        name: 'cluster',
        route: routes.cluster,
        icon: 'cluster',
        label: 'Cluster',
        beta: true
    },
    {
        name: 'management',
        route: routes.management,
        icon: 'manage',
        label: 'Management'
    }
]);

class MainLayoutViewModel extends StateListener {
    constructor() {
        super();

        this.navItems = navItems;
        this.breadcrumbs = ko.observable([]);
        this.area = ko.observable();
        this.panel = ko.observable('');

        registerForAlerts();
    }

    stateEventFilter(state) {
        return [ state.layout ];
    }

    onState({ layout }) {
        const { breadcrumbs, area, panel } = layout;

        this.breadcrumbs(breadcrumbs);
        this.area(area);
        this.panel(`${panel}-panel`);
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
