const { admin } = require("./config/firebase");

async function fixTemplate() {
    const rc = admin.remoteConfig();
    const template = await rc.getTemplate();
    const param = template.parameters["App_Config"];
    
    // The Prod condition has the correct values (version 18, 13 etc)
    const correctValues = JSON.parse(param.conditionalValues["Prod"].value);
    
    // Reset Default Value to match Prod
    param.defaultValue.value = JSON.stringify(correctValues, null, 2);
    
    // Ensure all conditionals match as well if they are out of sync
    if (param.conditionalValues["Debug"]) {
        param.conditionalValues["Debug"].value = JSON.stringify(correctValues, null, 2);
    }
    if (param.conditionalValues["Staging"]) {
        param.conditionalValues["Staging"].value = JSON.stringify(correctValues, null, 2);
    }
    
    await rc.publishTemplate(template);
    console.log("Remote Config synced and fixed!");
}

fixTemplate().catch(console.error);
