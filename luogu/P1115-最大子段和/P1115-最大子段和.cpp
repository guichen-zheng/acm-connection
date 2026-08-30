
#include <iostream>
#include <climits>
using namespace std;

using LL = long long;

int main()
{
    int n;
    cin >> n;

    LL sum = 0;
    LL ans = LLONG_MIN;

    for(int i = 1; i <= n; i++)
    {
        LL x;
        cin >> x;

        sum += x;
        ans = max(ans, sum);

        if(sum < 0) sum = 0;
    }

    cout << ans << endl;
    return 0;
}