export class ServiceBody {
    constructor(json) {
        this.bmlt_id = json.bmlt_id;  // should this be camel case to match javascript style?
        this.parent_bmlt_id = json.parent_bmlt_id;
        this.name = json.name;
        this.type = json.type;
        this.description = json.description;
        this.url = json.url;
        this.helpline = json.helpline;
        this.world_id = json.world_id;
        this.naws_code_override = json.naws_code_override;
    }
}
