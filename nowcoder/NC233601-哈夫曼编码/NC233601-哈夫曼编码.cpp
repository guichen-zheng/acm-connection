
#include <functional>
using namespace std;
using LL = long long;
int main()
{
    int n;
    cin >> n;

    priority_queue<LL, vector<LL>, greater<LL>> heap;

    for(int i = 1; i <= n; i++)
    {
        LL x;
        cin >> x;
        heap.push(x);
    }

    LL ans = 0;
    while(heap.size() > 1)
    {
        LL x = heap.top();
        heap.pop();

        LL y = heap.top();
        heap.pop();

        LL merged = x + y;
        ans += merged;
        heap.push(merged);
    }
    cout << ans << endl;
    return 0;
}