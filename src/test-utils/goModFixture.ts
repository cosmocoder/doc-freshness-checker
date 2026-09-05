export const GO_MOD_REQUIRE_FIXTURE = `module example.com/app

go 1.22

// require example.com/commented v9.0.0
require github.com/google/uuid v1.6.0
require   github.com/google/go-cmp   v0.6.0 // indirect

require (
  github.com/gin-gonic/gin v1.9.1
  golang.org/x/text v0.14.0 // indirect
)
`;
