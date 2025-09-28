import jsonfile from "jsonfile";
import moment from "moment";
import simpleGit from "simple-git";
import random from "random";

const path = "./data.json";
const git = simpleGit();

const markCommit = (date, message, callback) => {
  const data = {
    date: date,
  };

  jsonfile.writeFile(path, data, () => {
    git.add([path])
      .commit(message, { "--date": date }, callback);
  });
};

const makeCommitsForDay = (date, numCommits, callback) => {
  let commitsLeft = numCommits;

  const makeNext = () => {
    if (commitsLeft === 0) return callback();

    // Generate random hour, minute, second
    const hour = random.int(0, 23);
    const minute = random.int(0, 59);
    const second = random.int(0, 59);

    const commitDate = moment(date)
      .hour(hour)
      .minute(minute)
      .second(second)
      .format();

    markCommit(commitDate, `Commit on ${commitDate}`, () => {
      commitsLeft--;
      makeNext();
    });
  };

  makeNext();
};

const makeCommits = async () => {
  const startDate = moment("2025-09-27");
  const endDate = moment("2025-09-28");

  const days = endDate.diff(startDate, "days") + 1;

  const makeDayCommits = (dayIndex) => {
    if (dayIndex >= days) {
      return git.push();
    }

    const date = moment("2025-09-27").add(dayIndex, "days");
    const numCommits = random.int(5, 10); // <-- Random commits per day between 5 and 10

    makeCommitsForDay(date, numCommits, () => {
      makeDayCommits(dayIndex + 1);
    });
  };

  makeDayCommits(0);
};

makeCommits();
