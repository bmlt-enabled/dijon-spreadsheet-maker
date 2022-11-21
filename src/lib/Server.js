export class Server {
    constructor(json) {
        this.id = json.id;
        this.name = json.name;
        this.url = json.url;
        this.is_enabled = json.isEnabled;
    }

    menuName() {
        if (this.is_enabled) {
            return this.name;
        } else {
            return '[inactive] ' + this.name;
        }
    }

    // slight hack -- we want the server names that start with [inactive] or [do not use yet] to be at the bottom of the menu
    sortName() {
        return this.menuName().replace('[', 'ZZZZ')
    }
}
