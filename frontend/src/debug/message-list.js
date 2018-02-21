import ko from 'knockout';
import MessageRowViewModel from './message-row';

export default class MessageListViewModel {
    rows = ko.observableArray();

    onState(messages, selected) {
        const rows = messages
            .map((message, i) => {
                const row = this.rows()[i] || new MessageRowViewModel();
                row.onState(message, selected);
                return row;
            });

        this.rows(rows);
    }
}