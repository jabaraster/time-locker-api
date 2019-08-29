import * as sut from "../src/evernote-access";

(async () => {
  try {
    console.log(await sut.getTimeLockerNotebook());
  } catch (e) {
    console.log(e);
  }
})();