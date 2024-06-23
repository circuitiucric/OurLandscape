// D:\OLS\frontend\store\reducers.js
import { combineReducers } from "redux";

// 示例 reducer
const initialState = {};
const exampleReducer = (state = initialState, action) => {
  switch (action.type) {
    case "EXAMPLE_ACTION":
      return { ...state, ...action.payload };
    default:
      return state;
  }
};

const rootReducer = combineReducers({
  example: exampleReducer, // 在这里添加你的 reducers
});

export default rootReducer;
