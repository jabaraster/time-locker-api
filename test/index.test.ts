import * as sut from "../src/index";

(async () => {
    try {
        const res = await sut.getDailyResult();
        console.log(res.body);
    } catch (e) {
        console.log("!!! error !!!");
        console.log(e);
    }
})();