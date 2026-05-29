const { admin } = require("./config/firebase");

async function checkTemplate() {
    const rc = admin.remoteConfig();
    const template = await rc.getTemplate();
    const param = template.parameters["App_Config"];
    console.log("Default Value:", param.defaultValue.value);
    console.log("Conditional Values:", JSON.stringify(param.conditionalValues, null, 2));
}

checkTemplate().catch(console.error);
