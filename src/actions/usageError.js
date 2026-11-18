'use strict'
// Typed host-budget failures; never infer an error category from model/user text.
class UsageBudgetError extends Error {
 constructor(code){super(code);this.name='UsageBudgetError';this.code=code}
}
module.exports={UsageBudgetError}
