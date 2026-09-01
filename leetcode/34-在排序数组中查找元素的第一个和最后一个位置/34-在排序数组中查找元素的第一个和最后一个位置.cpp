class Solution
{
public:
    vector<int> searchRange(vector<int>& nums, int target)
    {
        int n = nums.size();
        if(n == 0) return {-1, -1};

        // 查找左端点：第一个 >= target 的位置
        int l = 0, r = n - 1;
        while(l < r)
        {
            int mid = l + (r - l) / 2;
            if(nums[mid] >= target) r = mid;
            else l = mid + 1;
        }

        if(nums[l] != target) return {-1, -1};
        int left = l;

        // 查找右端点：最后一个 <= target 的位置
        l = 0;
        r = n - 1;
        while(l < r)
        {
            int mid = l + (r - l + 1) / 2;
            if(nums[mid] <= target) l = mid;
            else r = mid - 1;
        }

        return {left, l};
    }
};