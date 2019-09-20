import * as sut from "../src/index";

(async () => {
    try {
        console.log(await sut.getDailyPlayResult());
    } catch (e) {
        console.log("!!! error !!!");
        console.log(e);
    }
})();